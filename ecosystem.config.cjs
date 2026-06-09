/**
 * PM2 生产环境配置
 * 用法（在项目根目录）：pm2 start ecosystem.config.cjs
 */
const path = require('node:path')

const serverDir = path.join(__dirname, 'apps', 'server')

module.exports = {
  apps: [
    {
      name: 'live-business-server',
      cwd: serverDir,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      /** PM2 5+：从 apps/server/.env 加载环境变量 */
      env_file: path.join(serverDir, '.env'),
      error_file: path.join(serverDir, 'logs', 'pm2-error.log'),
      out_file: path.join(serverDir, 'logs', 'pm2-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
