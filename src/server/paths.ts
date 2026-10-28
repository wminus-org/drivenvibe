import os from 'node:os';
import path from 'node:path';

export const HOME_DIR = path.join(os.homedir(), '.drivenvibe');
export const CONFIG_PATH = path.join(HOME_DIR, 'config.json');
export const STATE_PATH = path.join(HOME_DIR, 'state.json');
export const SETTINGS_PATH = path.join(HOME_DIR, 'settings.json');
