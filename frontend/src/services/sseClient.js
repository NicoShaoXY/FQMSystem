/**
 * 【P1新增】SSE实时推送客户端服务
 * 使用Server-Sent Events实现前端实时数据推送
 */

import { useEffect } from 'react';
import { API_BASE } from '../config/api';

// SSE事件类型
export const SSE_EVENTS = {
  CONNECTED: 'connected',
  SYSTEM_STATUS: 'system_status',
  YAODI_SIGNAL: 'yaodi_signal',      // 尧帝新信号
  SHUNDI_DECISION: 'shundi_decision', // 舜帝决策
  REDQUEEN_ALERT: 'redqueen_alert',    // 红后预警
  BLACKSWAN: 'blackswan',              // 黑天鹅事件
  HEARTBEAT: 'heartbeat',             // 心跳
};

// SSE连接状态
export const SSE_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

// SSE客户端管理
class SSEClient {
  constructor() {
    this.eventSource = null;
    this.status = SSE_STATUS.DISCONNECTED;
    this.listeners = new Map(); // eventType -> [callback]
    this.reconnectTimer = null;
    this.reconnectDelay = 5000; // 5秒后重连
    this.maxReconnectDelay = 60000; // 最多60秒
  }

  // 连接SSE
  connect() {
    if (this.eventSource) {
      this.eventSource.close();
    }
    
    this.status = SSE_STATUS.CONNECTING;
    console.log('[SSE] 开始连接...');
    
    try {
      this.eventSource = new EventSource(`${API_BASE}/sse/stream`);
      
      this.eventSource.onopen = () => {
        console.log('[SSE] 连接成功');
        this.status = SSE_STATUS.CONNECTED;
        this.reconnectDelay = 5000; // 重置重连延迟
        this.emit(SSE_EVENTS.CONNECTED, { status: 'connected' });
      };
      
      this.eventSource.onerror = (error) => {
        console.warn('[SSE] 连接错误:', error);
        this.status = SSE_STATUS.ERROR;
        this.emit(SSE_EVENTS.HEARTBEAT, { status: 'error', error });
        this.scheduleReconnect();
      };
      
      // 监听所有事件类型
      Object.values(SSE_EVENTS).forEach(eventType => {
        this.eventSource.addEventListener(eventType, (event) => {
          try {
            const data = JSON.parse(event.data);
            this.emit(eventType, data);
          } catch(e) {
            console.warn(`[SSE] 解析 ${eventType} 失败:`, e.message);
          }
        });
      });
      
    } catch(e) {
      console.error('[SSE] 连接失败:', e);
      this.status = SSE_STATUS.ERROR;
      this.scheduleReconnect();
    }
  }

  // 仅在未连接时建立连接（用于全局保持连接）
  connectIfNeeded() {
    if (this.status === SSE_STATUS.CONNECTED || this.status === SSE_STATUS.CONNECTING) {
      console.log('[SSE] 已连接或正在连接，跳过');
      return;
    }
    this.connect();
  }

  // 断开连接
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    this.status = SSE_STATUS.DISCONNECTED;
    console.log('[SSE] 已断开');
  }

  // 订阅事件
  subscribe(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType).push(callback);
    
    // 返回取消订阅函数
    return () => {
      const callbacks = this.listeners.get(eventType);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  // 仅取消订阅但不断开连接（用于页面切换时保持全局连接）
  unsubscribe(eventType, callback) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  // 发布事件
  emit(eventType, data) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      callbacks.forEach(cb => {
        try { cb(data); } catch(e) { console.error(`[SSE] 回调错误:`, e); }
      });
    }
  }

  // 定时重连
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    console.log(`[SSE] ${this.reconnectDelay/1000}秒后重连...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.status !== SSE_STATUS.CONNECTED) {
        this.connect();
      }
    }, this.reconnectDelay);
    
    // 指数退避
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  // 获取状态
  getStatus() {
    return this.status;
  }
}

// 创建单例
const sseClient = new SSEClient();

export default sseClient;

// 便捷的React Hook
export function useSSE(eventType, callback) {
  useEffect(() => {
    const unsubscribe = sseClient.subscribe(eventType, callback);
    return unsubscribe;
  }, [eventType, callback]);
}
