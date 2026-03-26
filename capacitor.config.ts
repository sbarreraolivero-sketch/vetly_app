import type { CapacitorConfig } from '@capacitor/cli';

import { Style } from '@capacitor/status-bar';

const config: CapacitorConfig = {
  appId: 'com.citenly.app',
  appName: 'Citenly AI',
  webDir: 'dist',
  plugins: {
    StatusBar: {
      style: Style.Light,
      backgroundColor: '#FFFFFF',
    },
  },
};

export default config;
