module.exports = {
  apps: [
    // ===== Backend =====
    {
      name: 'fqm-backend',
      cwd: '/Users/shao/Projects/FQMSystem',
      script: '/Users/shao/Projects/FQMSystem/fqm-backend-start.sh',
      interpreter: '/bin/bash',
      env: {
        NODE_OPTIONS: '--max-old-space-size=3072'
      },
      max_memory_restart: '3G',
      max_restarts: 10,
      restart_delay: 5000
    },
    // ===== Frontend =====
    {
      name: 'fqm-frontend',
      cwd: '/Users/shao/Projects/FQMSystem/frontend',
      script: '/Users/shao/Projects/FQMSystem/fqm-frontend-start.sh',
      interpreter: '/bin/bash',
      max_memory_restart: '1G',
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
