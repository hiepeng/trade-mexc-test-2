module.exports = {
  apps: [
    {
      name: 'hiep-mexc-test-2',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      error_file: './logs/error.log',
      log_file: './logs/combined.log',
      merge_logs: true,
      combine_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};

