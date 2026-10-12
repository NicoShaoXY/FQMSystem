/**
 * 全局提示服务
 * 
 * 使用方式：
 * import toast from './toast';
 * toast.success('操作成功');
 * toast.error('操作失败');
 * toast.loading('正在加载...');
 */

let toastContainer = null;
let toastId = 0;

// 初始化容器
function initContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
    document.body.appendChild(toastContainer);
  }
}

// 显示提示
function showToast(message, type = 'info', duration = 3000) {
  initContainer();
  
  const id = ++toastId;
  const toast = document.createElement('div');
  
  const colors = {
    success: 'background: linear-gradient(135deg, rgba(34,197,94,0.9), rgba(22,163,74,0.9))',
    error: 'background: linear-gradient(135deg, rgba(239,68,68,0.9), rgba(220,38,38,0.9))',
    warning: 'background: linear-gradient(135deg, rgba(245,158,11,0.9), rgba(217,119,6,0.9))',
    info: 'background: linear-gradient(135deg, rgba(59,130,246,0.9), rgba(37,99,235,0.9))',
    loading: 'background: linear-gradient(135deg, rgba(139,92,246,0.9), rgba(124,58,237,0.9))',
  };
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
    loading: '◐',
  };
  
  toast.id = `toast-${id}`;
  toast.style.cssText = `
    ${colors[type]}
    color: white;
    padding: 12px 16px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease;
    max-width: 320px;
  `;
  
  toast.innerHTML = `
    <span style="font-size: 16px; ${type === 'loading' ? 'animation: spin 1s linear infinite;' : ''}">${icons[type]}</span>
    <span>${message}</span>
  `;
  
  // 添加动画样式
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  
  toastContainer.appendChild(toast);
  
  // 自动消失（loading类型需要手动关闭）
  if (type !== 'loading' && duration > 0) {
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  
  return id;
}

// 关闭指定提示
function hideToast(id) {
  const toast = document.getElementById(`toast-${id}`);
  if (toast) {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }
}

export default {
  success: (msg, duration) => showToast(msg, 'success', duration),
  error: (msg, duration) => showToast(msg, 'error', duration),
  warning: (msg, duration) => showToast(msg, 'warning', duration),
  info: (msg, duration) => showToast(msg, 'info', duration),
  loading: (msg) => showToast(msg, 'loading', 0),
  hide: hideToast,
};
