/**
 * 心跳服务 - 检测浏览器标签关闭并通知后端
 *
 * 功能：
 * 1. 定期发送心跳到本地文件系统（通过后端API）
 * 2. 浏览器标签关闭时自动停止心跳
 * 3. 后端检测到心跳停止后自动关闭服务
 */

class HeartbeatService {
  constructor() {
    this.intervalId = null;
    this.heartbeatInterval = 10000; // 10秒一次心跳
    this.backendUrl = 'http://localhost:8769';
  }

  /**
   * 启动心跳服务
   */
  start() {
    if (this.intervalId) {
      console.log('[心跳] 服务已在运行');
      return;
    }

    console.log('[心跳] 启动心跳服务');

    // 立即发送一次心跳
    this.sendHeartbeat();

    // 定期发送心跳
    this.intervalId = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);

    // 监听页面卸载事件（标签关闭/刷新）
    window.addEventListener('beforeunload', () => {
      this.stop();
    });

    // 监听页面隐藏事件（标签切换）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('[心跳] 页面隐藏，继续发送心跳');
      } else {
        console.log('[心跳] 页面显示');
        this.sendHeartbeat();
      }
    });
  }

  /**
   * 发送心跳
   */
  async sendHeartbeat() {
    try {
      const response = await fetch(`${this.backendUrl}/api/system/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timestamp: Date.now(),
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });

      if (response.ok) {
        console.log('[心跳] ✅ 心跳发送成功');
      } else {
        console.error('[心跳] ❌ 心跳发送失败:', response.status);
      }
    } catch (error) {
      console.error('[心跳] ❌ 心跳发送错误:', error.message);
    }
  }

  /**
   * 停止心跳服务
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[心跳] 心跳服务已停止');
    }

    // 发送停止信号
    this.sendStopSignal();
  }

  /**
   * 发送停止信号
   */
  async sendStopSignal() {
    try {
      await fetch(`${this.backendUrl}/api/system/heartbeat/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timestamp: Date.now(),
          reason: 'browser_closed',
        }),
      });
      console.log('[心跳] ✅ 停止信号已发送');
    } catch (error) {
      console.error('[心跳] ❌ 停止信号发送失败:', error.message);
    }
  }
}

// 创建单例
const heartbeatService = new HeartbeatService();

export default heartbeatService;
