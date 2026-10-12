#!/usr/bin/env python3.11
"""
ML训练桥接脚本 v3 - 3日收益率回归
输入: stdin JSON { model, X, Y, feature_names }
输出: stdout JSON { success, accuracy, trainAcc, testAcc, params, feature_importance }

Y = 3日收益率（连续值），所有模型改为回归模式
准确率 = 方向准确率（预测涨跌方向正确的比例）
"""
import sys, json, time, traceback, os, sqlite3, os, sqlite3
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.svm import SVR
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import r2_score, mean_squared_error
from sklearn.neural_network import MLPRegressor
from sklearn.naive_bayes import GaussianNB


def _direction_accuracy(y_true, y_pred):
    """方向准确率：预测涨跌方向正确的比例"""
    return float(np.mean((y_true > 0) == (y_pred > 0)))


# ── Checkpoint 写入 ─────────────────────────────────────────────
DB_PATH = os.environ.get('FQM_DB_PATH',
                     '/Users/shao/Desktop/FQMSystem/database/stocks.db')
_CHECKPOINT_INTERVAL = 10  # 每 N 棵树写一次 checkpoint

def save_checkpoint(model_id, trees_built, total_trees, status='in_progress'):
    """向 ml_training_checkpoint 表写入进度（Python 训练侧直写）"""
    try:
        progress_pct = round(trees_built / total_trees * 100, 1) if total_trees > 0 else 0.0
        conn = sqlite3.connect(DB_PATH, timeout=5)
        conn.execute('''
            INSERT INTO ml_training_checkpoint
            (model_id, status, trees_built, total_trees, progress_pct, checkpoint_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(model_id) DO UPDATE SET
                trees_built=excluded.trees_built,
                total_trees=excluded.total_trees,
                progress_pct=excluded.progress_pct,
                checkpoint_at=excluded.checkpoint_at,
                status=excluded.status
        ''', (model_id, status, trees_built, total_trees, progress_pct))
        conn.commit()
        conn.close()
    except Exception:
        pass  # 训练期间 DB 错误不中断训练


# ── LightGBM 每 N 轮 checkpoint callback ────────────────────
class LGBMCheckpointCallback:
    """LightGBM 自定义 callback：每 N 轮写入 checkpoint"""
    def __init__(self, model_id, total_trees):
        self.model_id = model_id
        self.total_trees = total_trees
        self.last_written = 0
    def __call__(self, env):
        # env.iteration: 当前轮次（从 0 开始）
        trees = env.iteration + 1
        if trees - self.last_written >= _CHECKPOINT_INTERVAL:
            save_checkpoint(self.model_id, trees, self.total_trees)
            self.last_written = trees


# ── XGBoost 每 N 轮 checkpoint callback ─────────────────────
def make_xgboost_checkpoint_callback(model_id, total_trees):
    """返回 XGBoost callback 函数（兼容所有版本）"""
    last_written = [0]
    def callback(env):
        # env.iteration: 当前轮次（0-indexed）
        trees = env.iteration + 1
        if trees - last_written[0] >= _CHECKPOINT_INTERVAL:
            save_checkpoint(model_id, trees, total_trees)
            last_written[0] = trees
    return callback


def _export_sklearn_tree(tree, n_features, value_offset=0.0):
    """递归导出sklearn决策树为JS兼容格式"""
    tree_ = tree.tree_
    def recurse(node):
        if tree_.feature[node] == -2:  # leaf
            val = float(tree_.value[node][0][0])  # regressor: [0][0]
            return {"feature": -1, "threshold": 0, "left": None, "right": None,
                    "value": val - value_offset}
        feat = int(tree_.feature[node])
        thresh = float(tree_.threshold[node])
        left = recurse(tree_.children_left[node])
        right = recurse(tree_.children_right[node])
        return {"feature": feat, "threshold": thresh, "left": left, "right": right, "value": 0}
    return recurse(0)


def _export_xgb_trees(booster, n_features):
    """导出XGBoost trees为JS兼容格式"""
    dump = booster.get_dump(dump_format='json')
    js_trees = []
    for t_str in dump:
        t = json.loads(t_str)
        def convert(node):
            if 'leaf' in node:
                return {"feature": -1, "threshold": 0, "left": None, "right": None,
                        "value": float(node['leaf'])}
            feat = int(node['split'].lstrip('f'))
            return {"feature": feat, "threshold": float(node['split_condition']),
                    "left": convert(node['children'][0]), "right": convert(node['children'][1]),
                    "value": 0}
        js_trees.append(convert(t))
    return js_trees


def _export_lgb_trees(model, n_features):
    """导出LightGBM trees为JS兼容格式"""
    js_trees = []
    booster = model.booster_
    tree_df = booster.trees_to_dataframe()
    for tree_idx in sorted(tree_df['tree_index'].unique()):
        tree_nodes = tree_df[tree_df['tree_index'] == tree_idx]
        tree_map = {}
        for _, row in tree_nodes.iterrows():
            nid = row['node_index']
            is_leaf = 'leaf_value' in row and row['leaf_value'] is not None
            if is_leaf:
                tree_map[nid] = {"feature": -1, "threshold": 0, "left": None, "right": None,
                                 "value": float(row['leaf_value'])}
            else:
                tree_map[nid] = {"feature": int(row['split_feature']),
                                 "threshold": float(row['threshold']),
                                 "left": None, "right": None, "value": 0}
        for _, row in tree_nodes.iterrows():
            nid = row['node_index']
            if 'left_child' in row and row['left_child'] in tree_map:
                tree_map[nid]['left'] = tree_map[row['left_child']]
                tree_map[nid]['right'] = tree_map[row['right_child']]
        root_id = tree_nodes.iloc[0]['node_index']
        js_trees.append(tree_map[root_id])
    return js_trees


def train_model(model_name, X, Y, feature_names):
    """训练指定模型（3日收益率回归），返回结果"""
    n_samples = len(X)

    # 模型复杂度对应的最小样本要求
    COMPLEXITY_REQUIREMENTS = {
        'xgboost':      500,
        'lightgbm':     500,
        'randomforest': 500,
        'catboost':     500,
        'linear':       200,
        'svm':          300,
        'bayesian':     100,
        'lstm':         300,
        'gru':          300,
        'cnn':          300,
        'transformer': 500,
        'autoencoder': 500,
        'gnn':          400,
        'rl':           200,
    }
    min_needed = COMPLEXITY_REQUIREMENTS.get(model_name, 100)

    if n_samples < 50:
        return {
            "success": False,
            "error": f"样本不足({n_samples}<50)",
            "need_expand": True,
            "current_samples": int(n_samples),
            "min_needed": min_needed,
        }

    if n_samples < min_needed:
        return {
            "success": False,
            "error": f"样本不足以训练{model_name}({n_samples}<{min_needed})",
            "need_expand": True,
            "current_samples": int(n_samples),
            "min_needed": min_needed,
        }

    MAX_SAMPLES = 100000
    if n_samples > MAX_SAMPLES:
        idx = np.random.choice(n_samples, MAX_SAMPLES, replace=False)
        X = X[idx]; Y = Y[idx]; n_samples = MAX_SAMPLES

    split = int(n_samples * 0.8)
    perm = np.random.permutation(n_samples)
    train_idx, test_idx = perm[:split], perm[split:]
    X_train, Y_train = X[train_idx], Y[train_idx]
    X_test, Y_test = X[test_idx], Y[test_idx]

    scaler = None
    needs_scaler = model_name in ('linear', 'svm', 'mlp', 'lstm', 'gru', 'cnn', 'transformer', 'autoencoder', 'gnn', 'rl', 'bayesian')
    if needs_scaler:
        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X_train)
        X_test_s = scaler.transform(X_test)
    else:
        X_train_s, X_test_s = X_train, X_test

    model = None
    params = {}
    feature_importance = None
    t0 = time.time()

    if model_name == 'linear':
        model = Ridge(alpha=1.0)
        model.fit(X_train_s, Y_train)
        params = {
            "python_model": True,
            "w": model.coef_.tolist(),
            "b": float(model.intercept_),
            "scaler_mean": scaler.mean_.tolist(),
            "scaler_std": scaler.scale_.tolist()
        }
        feature_importance = np.abs(model.coef_).tolist()

    elif model_name == 'randomforest':
        # RandomForest 并行训练，无法逐树 callback；
        # 用 warm_start 逐批训练，每 10 棵树写一次 checkpoint
        n_total = 300
        batch_size = 10
        model = RandomForestRegressor(
            n_estimators=batch_size, max_depth=12, min_samples_leaf=30,
            n_jobs=-1, random_state=42, warm_start=True
        )
        save_checkpoint(model_name, 0, n_total, 'in_progress')
        for built in range(batch_size, n_total + batch_size, batch_size):
            model.n_estimators = min(built, n_total)
            model.fit(X_train, Y_train)
            save_checkpoint(model_name, min(built, n_total), n_total, 'in_progress')
        # 最终 feature_importances_ 需在完整树后获取
        n_features = X_train.shape[1]
        trees = [_export_sklearn_tree(estimator, n_features) for estimator in model.estimators_]
        params = {"python_model": True, "trees": trees}
        feature_importance = model.feature_importances_.tolist()

    elif model_name == 'xgboost':
        import xgboost as xgb
        n_trees = 500
        # xgboost 3.x: 使用 early_stopping_rounds 参数（不支持自定义 checkpoint callback）
        model = xgb.XGBRegressor(
            n_estimators=n_trees, max_depth=7, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8,
            min_child_weight=30, gamma=0.05, reg_alpha=0.1, reg_lambda=1.0,
            n_jobs=-1, random_state=42,
            early_stopping_rounds=50
        )
        model.fit(X_train, Y_train, eval_set=[(X_test, Y_test)], verbose=False)
        save_checkpoint(model_name, model.best_iteration or n_trees, n_trees, 'in_progress')  # 最终进度
        n_features = X_train.shape[1]
        trees = _export_xgb_trees(model.get_booster(), n_features)
        params = {"python_model": True, "trees": trees, "base_score": float(model.get_booster().attributes().get('base_score', 0.5))}
        feature_importance = model.feature_importances_.tolist()

    elif model_name == 'lightgbm':
        import lightgbm as lgb
        import logging
        lgb.register_logger(logging.getLogger('lightgbm_silent'))
        n_trees = 500
        model = lgb.LGBMRegressor(
            n_estimators=n_trees, max_depth=7, learning_rate=0.05,
            num_leaves=40, subsample=0.8, colsample_bytree=0.8,
            min_child_samples=30, reg_alpha=0.1, reg_lambda=1.0,
            n_jobs=-1, random_state=42, verbose=-1
        )
        # LightGBM callback：每 10 棵树写 checkpoint
        lgb_cb = LGBMCheckpointCallback(model_name, n_trees)
        model.fit(X_train, Y_train, eval_set=[(X_test, Y_test)],
                 callbacks=[lgb.early_stopping(50), lgb.log_evaluation(0), lgb_cb])
        # 最终进度（可能 early_stopping 提前停止）
        final_trees = int(model.n_iter_)
        save_checkpoint(model_name, final_trees, n_trees, 'completed')
        n_features = X_train.shape[1]
        try:
            trees = _export_lgb_trees(model, n_features)
        except Exception:
            trees = []
        params = {"python_model": True, "trees": trees, "n_estimators": 200,
                  "feature_importances": model.feature_importances_.tolist()}
        feature_importance = model.feature_importances_.tolist()

    elif model_name == 'svm':
        svm_max = 20000
        if len(X_train_s) > svm_max:
            idx = np.random.choice(len(X_train_s), svm_max, replace=False)
            X_train_s_sub = X_train_s[idx]; Y_train_sub = Y_train[idx]
        else:
            X_train_s_sub, Y_train_sub = X_train_s, Y_train
        model = SVR(kernel='rbf', C=1.0, gamma='scale')
        model.fit(X_train_s_sub, Y_train_sub)
        params = {
            "python_model": True,
            "svm_type": "rbf",
            "scaler_mean": scaler.mean_.tolist(),
            "scaler_std": scaler.scale_.tolist(),
            "n_support": len(model.support_),
            "support_vectors_truncated": False
        }
        feature_importance = None

    elif model_name == 'gradientboosting':
        from sklearn.utils import resample
        n_total = 100
        model = GradientBoostingRegressor(
            n_estimators=1, max_depth=5, learning_rate=0.1,
            min_samples_leaf=50, subsample=0.8, random_state=42
        )
        save_checkpoint(model_name, 0, n_total, 'in_progress')
        # 逐树训练（sklearn 不支持 warm_start for GB）
        # 改用 staged_predict 思想：训练完整模型后无进度
        # 退而求其次：在训练前写 0%，训练后写 100%
        # （GB 逐树训练需重写，此处保持原逻辑，进度条用 0→100 跳变）
        model = GradientBoostingRegressor(
            n_estimators=n_total, max_depth=5, learning_rate=0.1,
            min_samples_leaf=50, subsample=0.8, random_state=42
        )
        model.fit(X_train, Y_train)
        save_checkpoint(model_name, n_total, n_total, 'completed')
        n_features = X_train.shape[1]
        init_score = float(model.init_.predict([[0]*n_features])[0])
        trees = []
        for estimator in model.estimators_:
            tree = _export_sklearn_tree(estimator[0], n_features)
            trees.append(tree)
        params = {"python_model": True, "trees": trees, "init_score": init_score, "lr": float(model.learning_rate)}
        feature_importance = model.feature_importances_.tolist()

    elif model_name == 'mlp':
        model = MLPRegressor(
            hidden_layer_sizes=(128, 64, 32),
            max_iter=200, learning_rate='adaptive',
            early_stopping=True, validation_fraction=0.1,
            random_state=42
        )
        model.fit(X_train_s, Y_train)
        params = {
            "python_model": True,
            "scaler_mean": scaler.mean_.tolist(),
            "scaler_std": scaler.scale_.tolist(),
            "layers": [coefs.shape[0] for coefs in model.coefs_],
            "weights": [c.tolist() for c in model.coefs_],
            "biases": [b.tolist() for b in model.intercepts_],
            "n_iter": int(model.n_iter_)
        }
        feature_importance = None

    elif model_name == 'catboost':
        from catboost import CatBoostRegressor
        n_total = 200
        model = CatBoostRegressor(
            n_estimators=n_total, max_depth=6, learning_rate=0.05,
            subsample=0.8, random_state=42, verbose=0
        )
        save_checkpoint(model_name, 0, n_total, 'in_progress')
        # CatBoost 支持自定义 callback（需继承 CatBoostCallback）
        # 简化方案：训练完成后写 100%
        model.fit(X_train, Y_train, eval_set=(X_test, Y_test))
        save_checkpoint(model_name, n_total, n_total, 'completed')
        n_features = X_train.shape[1]
        init_score = float(model.init_.predict([[0]*n_features])[0])
        trees = []
        for estimator in model.estimators_:
            tree = _export_sklearn_tree(estimator[0], n_features)
            trees.append(tree)
        params = {"python_model": True, "trees": trees, "init_score": init_score, "lr": float(model.learning_rate)}
        feature_importance = model.feature_importances_.tolist()

    # === PyTorch 深度学习模型（回归版）===
    elif model_name in ('lstm', 'gru', 'cnn', 'transformer', 'autoencoder', 'gnn'):
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader, TensorDataset

        X_t = torch.FloatTensor(X_train_s)
        Y_t = torch.FloatTensor(Y_train).unsqueeze(1)
        Xt_t = torch.FloatTensor(X_test_s)
        Yt_t = torch.FloatTensor(Y_test).unsqueeze(1)
        n_feat = X_train_s.shape[1]
        hidden = 64
        lr_ = 0.001
        epochs = 30
        batch_sz = 512

        if model_name == 'lstm':
            class LSTMNet(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.lstm = nn.LSTM(n_feat, hidden, num_layers=2, batch_first=True, dropout=0.2)
                    self.fc = nn.Linear(hidden, 1)
                def forward(self, x):
                    x = x.unsqueeze(1)
                    _, (h, _) = self.lstm(x)
                    return self.fc(h[-1])  # 回归：无sigmoid
            net = LSTMNet()
        elif model_name == 'gru':
            class GRUNet(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.gru = nn.GRU(n_feat, hidden, num_layers=2, batch_first=True, dropout=0.2)
                    self.fc = nn.Linear(hidden, 1)
                def forward(self, x):
                    x = x.unsqueeze(1)
                    _, h = self.gru(x)
                    return self.fc(h[-1])  # 回归：无sigmoid
            net = GRUNet()
        elif model_name == 'cnn':
            class CNNNet(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.conv1 = nn.Conv1d(1, 32, 3, padding=1)
                    self.conv2 = nn.Conv1d(32, 16, 3, padding=1)
                    self.pool = nn.MaxPool1d(2)
                    self.adaptive = nn.AdaptiveAvgPool1d(8)
                    self.fc1 = nn.Linear(16 * 8, 32)
                    self.fc2 = nn.Linear(32, 1)
                def forward(self, x):
                    x = x.unsqueeze(1)
                    x = torch.relu(self.pool(self.conv1(x)))
                    x = torch.relu(self.pool(self.conv2(x)))
                    x = self.adaptive(x)
                    x = x.view(x.size(0), -1)
                    x = torch.relu(self.fc1(x))
                    return self.fc2(x)  # 回归：无sigmoid
            net = CNNNet()
        elif model_name == 'transformer':
            class TransformerNet(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.embed = nn.Linear(n_feat, 64)
                    enc_layer = nn.TransformerEncoderLayer(d_model=64, nhead=4, dim_feedforward=128, dropout=0.1, batch_first=True)
                    self.transformer = nn.TransformerEncoder(enc_layer, num_layers=2)
                    self.fc = nn.Linear(64, 1)
                def forward(self, x):
                    x = self.embed(x).unsqueeze(1)
                    x = self.transformer(x)
                    return self.fc(x[:, -1, :])  # 回归：无sigmoid
            net = TransformerNet()
        elif model_name == 'autoencoder':
            class AENet(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.encoder = nn.Sequential(nn.Linear(n_feat, 64), nn.ReLU(), nn.Linear(64, 16), nn.ReLU())
                    self.decoder = nn.Sequential(nn.Linear(16, 64), nn.ReLU(), nn.Linear(64, n_feat))
                    self.regressor = nn.Sequential(nn.Linear(16, 8), nn.ReLU(), nn.Linear(8, 1))
                def forward(self, x):
                    z = self.encoder(x)
                    return self.regressor(z)  # 回归：无sigmoid
            net = AENet()
        elif model_name == 'gnn':
            class GNNNet(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.fc1 = nn.Linear(n_feat * 2, 128)
                    self.fc2 = nn.Linear(128, 64)
                    self.fc3 = nn.Linear(64, 1)
                def forward(self, x):
                    mean_feat = x.mean(dim=0, keepdim=True).expand_as(x)
                    combined = torch.cat([x, mean_feat], dim=1)
                    h = torch.relu(self.fc1(combined))
                    h = torch.relu(self.fc2(h))
                    return self.fc3(h)  # 回归：无sigmoid
            net = GNNNet()

        optimizer = torch.optim.Adam(net.parameters(), lr=lr_)
        criterion = nn.MSELoss()  # 回归用MSE
        loader = DataLoader(TensorDataset(X_t, Y_t), batch_size=batch_sz, shuffle=True)
        net.train()
        for ep in range(epochs):
            for bx, by in loader:
                optimizer.zero_grad()
                loss = criterion(net(bx), by)
                loss.backward()
                optimizer.step()

        # 导出权重
        weights_list, biases_list = [], []
        for layer in net.modules():
            if isinstance(layer, nn.Linear):
                weights_list.append(layer.weight.data.tolist())
                biases_list.append(layer.bias.data.tolist())

        net.eval()
        with torch.no_grad():
            train_preds = net(X_t).squeeze().numpy()
            test_preds = net(Xt_t).squeeze().numpy()
        # 准确率 = 方向准确率
        train_acc = _direction_accuracy(Y_train, train_preds)
        test_acc = _direction_accuracy(Y_test, test_preds)
        train_r2 = float(r2_score(Y_train, train_preds))
        test_r2 = float(r2_score(Y_test, test_preds))
        train_time = time.time() - t0

        params = {
            "python_model": True,
            "torch_model": model_name,
            "scaler_mean": scaler.mean_.tolist() if scaler else None,
            "scaler_std": scaler.scale_.tolist() if scaler else None,
            "weights": weights_list,
            "biases": biases_list,
            "layers": [(len(w), len(w[0])) for w in weights_list]
        }
        return {
            "success": True, "modelId": model_name,
            "accuracy": test_acc, "trainAcc": train_acc, "testAcc": test_acc,
            "r2": test_r2, "trainR2": train_r2,
            "sample_count": n_samples, "train_time": round(train_time, 2),
            "params": params, "featureImportance": None,
            "diagnostics": {
                "directionAccuracy": f"{test_acc*100:.1f}%",
                "r2": f"{test_r2:.4f}", "rmse": f"{np.sqrt(mean_squared_error(Y_test, test_preds)):.4f}",
                "trainTime": f"{train_time:.1f}s",
                "trainSamples": len(X_train), "testSamples": len(X_test),
                "nFeatures": n_feat
            }
        }

    elif model_name == 'rl':
        # 强化学习→简化为回归网络
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader, TensorDataset

        X_t = torch.FloatTensor(X_train_s)
        Y_t = torch.FloatTensor(Y_train).unsqueeze(1)
        Xt_t = torch.FloatTensor(X_test_s)
        Yt_t = torch.FloatTensor(Y_test).unsqueeze(1)
        n_feat = X_train_s.shape[1]

        class RLNet(nn.Module):
            def __init__(self):
                super().__init__()
                self.net = nn.Sequential(
                    nn.Linear(n_feat, 128), nn.ReLU(), nn.Dropout(0.2),
                    nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.2),
                    nn.Linear(64, 1)  # 回归：输出1维3日收益率
                )
            def forward(self, x):
                return self.net(x)

        rlnet = RLNet()
        optimizer = torch.optim.Adam(rlnet.parameters(), lr=0.001)
        criterion = nn.MSELoss()
        loader = DataLoader(TensorDataset(X_t, Y_t), batch_size=512, shuffle=True)
        rlnet.train()
        for ep in range(30):
            for bx, by in loader:
                optimizer.zero_grad()
                loss = criterion(rlnet(bx), by)
                loss.backward()
                optimizer.step()

        rlnet.eval()
        with torch.no_grad():
            train_preds = rlnet(X_t).squeeze().numpy()
            test_preds = rlnet(Xt_t).squeeze().numpy()
        train_acc = _direction_accuracy(Y_train, train_preds)
        test_acc = _direction_accuracy(Y_test, test_preds)
        train_time = time.time() - t0

        weights_list, biases_list = [], []
        for layer in rlnet.modules():
            if isinstance(layer, nn.Linear):
                weights_list.append(layer.weight.data.tolist())
                biases_list.append(layer.bias.data.tolist())

        params = {
            "python_model": True, "torch_model": "rl",
            "scaler_mean": scaler.mean_.tolist() if scaler else None,
            "scaler_std": scaler.scale_.tolist() if scaler else None,
            "weights": weights_list, "biases": biases_list,
            "layers": [(len(w), len(w[0])) for w in weights_list]
        }
        return {
            "success": True, "modelId": model_name,
            "accuracy": test_acc, "trainAcc": train_acc, "testAcc": test_acc,
            "sample_count": n_samples, "train_time": round(train_time, 2),
            "params": params, "featureImportance": None,
            "diagnostics": {
                "directionAccuracy": f"{test_acc*100:.1f}%",
                "trainTime": f"{train_time:.1f}s",
                "trainSamples": len(X_train), "testSamples": len(X_test),
                "nFeatures": n_feat
            }
        }

    elif model_name == 'bayesian':
        # 贝叶斯：用分箱+GaussianNB分类代替回归
        # 将3日收益率分为3类：跌(<0)、平(~0)、涨(>0)
        from sklearn.naive_bayes import GaussianNB
        Y_train_cls = (Y_train > 0).astype(int)
        Y_test_cls = (Y_test > 0).astype(int)
        model = GaussianNB()
        model.fit(X_train_s, Y_train_cls)
        train_preds = model.predict(X_train_s)
        test_preds = model.predict(X_test_s)
        train_acc = float(np.mean(Y_train_cls == train_preds))
        test_acc = float(np.mean(Y_test_cls == test_preds))
        train_time = time.time() - t0
        params = {
            "python_model": True, "bayesian_type": "gaussian_nb",
            "scaler_mean": scaler.mean_.tolist(),
            "scaler_std": scaler.scale_.tolist(),
            "class_prior": model.class_prior_.tolist(),
            "theta": model.theta_.tolist(),
            "var": [np.maximum(v, 1e-9).tolist() for v in model.var_]
        }
        return {
            "success": True, "modelId": model_name,
            "accuracy": test_acc, "trainAcc": train_acc, "testAcc": test_acc,
            "sample_count": n_samples, "train_time": round(train_time, 2),
            "params": params, "featureImportance": None,
            "diagnostics": {
                "directionAccuracy": f"{test_acc*100:.1f}%",
                "trainTime": f"{train_time:.1f}s",
                "trainSamples": len(X_train), "testSamples": len(X_test),
                "nFeatures": X.shape[1]
            }
        }

    elif model_name == 'arima':
        return {"success": False, "error": "ARIMA是时序模型，不参与3日收益率训练"}

    elif model_name == 'garch':
        return {"success": False, "error": "GARCH是波动率模型，不参与3日收益率训练"}

    else:
        model = GradientBoostingRegressor(
            n_estimators=100, max_depth=5, learning_rate=0.1,
            min_samples_leaf=50, subsample=0.8, random_state=42
        )
        model.fit(X_train, Y_train)
        n_features = X_train.shape[1]
        init_score = float(model.init_.predict([[0]*n_features])[0])
        trees = [_export_sklearn_tree(e[0], n_features) for e in model.estimators_]
        params = {"python_model": True, "trees": trees, "init_score": init_score, "lr": float(model.learning_rate)}
        feature_importance = model.feature_importances_.tolist()

    train_time = time.time() - t0

    # 评估：方向准确率
    if model_name in ('linear', 'svm', 'mlp'):
        train_preds = model.predict(X_train_s)
        test_preds = model.predict(X_test_s)
    else:
        train_preds = model.predict(X_train)
        test_preds = model.predict(X_test)

    train_acc = _direction_accuracy(Y_train, train_preds)
    test_acc = _direction_accuracy(Y_test, test_preds)
    test_r2 = float(r2_score(Y_test, test_preds))

    return {
        "success": True, "modelId": model_name,
        "accuracy": test_acc, "trainAcc": train_acc, "testAcc": test_acc,
        "r2": test_r2,
        "sample_count": n_samples, "train_time": round(train_time, 2),
        "params": params, "featureImportance": feature_importance,
        "featureNames": feature_names,
        "diagnostics": {
            "directionAccuracy": f"{test_acc*100:.1f}%", "r2": f"{test_r2:.4f}",
            "rmse": f"{np.sqrt(mean_squared_error(Y_test, test_preds)):.4f}",
            "trainTime": f"{train_time:.1f}s",
            "trainSamples": len(X_train), "testSamples": len(X_test),
            "nFeatures": X.shape[1] if hasattr(X, 'shape') else len(X[0])
        }
    }


def main():
    try:
        # 支持 --file 参数或 stdin 输入
        if len(sys.argv) > 2 and sys.argv[1] == '--file':
            with open(sys.argv[2], 'r') as f:
                raw = f.read()
        else:
            raw = sys.stdin.read()
        data = json.loads(raw)
        model_name = data.get('model', 'linear')
        X = np.array(data['X'], dtype=np.float64)
        Y = np.array(data['Y'], dtype=np.float64)  # 3日收益率：连续值
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        Y = np.nan_to_num(Y, nan=0.0, posinf=0.0, neginf=0.0)
        result = train_model(model_name, X, Y, data.get('feature_names', []))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "traceback": traceback.format_exc()}, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()