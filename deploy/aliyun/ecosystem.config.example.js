module.exports = {
  apps: [
    {
      name: 'zhubo-analysis',
      cwd: '/www/wwwroot/zhubo-analysis',
      script: 'deploy/aliyun/pm2-start.sh',
      interpreter: 'bash',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '900M',
      time: true,
      merge_logs: true,
      out_file: '/www/wwwroot/zhubo-analysis/logs/pm2-out.log',
      error_file: '/www/wwwroot/zhubo-analysis/logs/pm2-error.log',
    },
  ],
}
