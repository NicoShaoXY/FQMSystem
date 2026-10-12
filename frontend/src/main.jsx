import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 错误边界
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('React Error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: '#0a0e1a', color: '#fff', padding: 40 }}>
          <h1 style={{ color: '#f5222d' }}>出错了</h1>
          <pre style={{ color: '#faad14' }}>{this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

try {
  createRoot(document.getElementById('root')).render(
    <React.Fragment>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.Fragment>,
  );
} catch (e) {
  document.getElementById('root').innerHTML = '<div style="background:#0a0e1a;color:#fff;padding:40;"><h1>加载失败</h1><pre>' + e.message + '</pre></div>';
}
