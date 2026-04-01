import '@testing-library/jest-dom';

// Mock Taro API
global.wx = {
  getSystemInfoSync: jest.fn(() => ({
    windowWidth: 375,
    windowHeight: 667,
    screenWidth: 375,
    screenHeight: 667,
    statusBarHeight: 20,
    platform: 'ios',
    model: 'iPhone X',
    system: 'iOS 14.0',
    version: '8.0.0'
  })),
  getStorageSync: jest.fn(),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  login: jest.fn(),
  request: jest.fn(),
  showToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  showModal: jest.fn(),
  navigateTo: jest.fn(),
  redirectTo: jest.fn(),
  navigateBack: jest.fn(),
  switchTab: jest.fn(),
  reLaunch: jest.fn(),
  chooseImage: jest.fn(),
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  scanCode: jest.fn(),
  getLocation: jest.fn(),
  openLocation: jest.fn(),
  createAnimation: jest.fn(() => ({
    translateX: jest.fn().mockReturnThis(),
    translateY: jest.fn().mockReturnThis(),
    scale: jest.fn().mockReturnThis(),
    rotate: jest.fn().mockReturnThis(),
    opacity: jest.fn().mockReturnThis(),
    step: jest.fn().mockReturnThis(),
    export: jest.fn(() => ({})),
  })),
} as any;

// Mock Taro
jest.mock('@tarojs/taro', () => ({
  getSystemInfoSync: jest.fn(() => ({
    windowWidth: 375,
    windowHeight: 667,
    screenWidth: 375,
    screenHeight: 667,
    statusBarHeight: 20,
    platform: 'ios',
    safeArea: { top: 44, bottom: 34, left: 0, right: 375, width: 375, height: 778 }
  })),
  getStorageSync: jest.fn(),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  getStorage: jest.fn(),
  setStorage: jest.fn(),
  removeStorage: jest.fn(),
  login: jest.fn(),
  request: jest.fn(),
  showToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  showModal: jest.fn(),
  navigateTo: jest.fn(),
  redirectTo: jest.fn(),
  navigateBack: jest.fn(),
  switchTab: jest.fn(),
  reLaunch: jest.fn(),
  chooseImage: jest.fn(),
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  scanCode: jest.fn(),
  getLocation: jest.fn(),
  openLocation: jest.fn(),
  createAnimation: jest.fn(() => ({
    translateX: jest.fn().mockReturnThis(),
    translateY: jest.fn().mockReturnThis(),
    scale: jest.fn().mockReturnThis(),
    rotate: jest.fn().mockReturnThis(),
    opacity: jest.fn().mockReturnThis(),
    step: jest.fn().mockReturnThis(),
    export: jest.fn(() => ({})),
  })),
  useLoad: jest.fn((callback) => callback()),
  useDidShow: jest.fn((callback) => callback()),
  useDidHide: jest.fn(),
  useReady: jest.fn((callback) => callback()),
  useUnload: jest.fn(),
  usePullDownRefresh: jest.fn(),
  useReachBottom: jest.fn(),
  useShareAppMessage: jest.fn(),
  useShareTimeline: jest.fn(),
  useAddToFavorites: jest.fn(),
  usePageScroll: jest.fn(),
  useResize: jest.fn(),
  useTabItemTap: jest.fn(),
  useSaveExitState: jest.fn(),
  eventCenter: {
    on: jest.fn(),
    off: jest.fn(),
    trigger: jest.fn(),
  },
  Current: {
    router: {
      path: '/pages/index/index',
      params: {}
    }
  }
}));

// Mock @tarojs/components
jest.mock('@tarojs/components', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('div', props, children),
    Text: ({ children, ...props }: any) => React.createElement('span', props, children),
    Image: ({ ...props }: any) => React.createElement('img', props),
    Button: ({ children, ...props }: any) => React.createElement('button', props, children),
    Input: ({ ...props }: any) => React.createElement('input', props),
    Textarea: ({ ...props }: any) => React.createElement('textarea', props),
    ScrollView: ({ children, ...props }: any) => React.createElement('div', props, children),
    Swiper: ({ children, ...props }: any) => React.createElement('div', props, children),
    SwiperItem: ({ children, ...props }: any) => React.createElement('div', props, children),
    Navigator: ({ children, ...props }: any) => React.createElement('a', props, children),
    RichText: ({ ...props }: any) => React.createElement('div', { dangerouslySetInnerHTML: { __html: props.nodes } }),
    Icon: ({ ...props }: any) => React.createElement('span', props),
    Progress: ({ ...props }: any) => React.createElement('progress', props),
    Checkbox: ({ ...props }: any) => React.createElement('input', { type: 'checkbox', ...props }),
    Radio: ({ ...props }: any) => React.createElement('input', { type: 'radio', ...props }),
    Form: ({ children, ...props }: any) => React.createElement('form', props, children),
    Label: ({ children, ...props }: any) => React.createElement('label', props, children),
    Picker: ({ children, ...props }: any) => React.createElement('select', props, children),
    PickerView: ({ ...props }: any) => React.createElement('div', props),
    Switch: ({ ...props }: any) => React.createElement('input', { type: 'checkbox', ...props }),
    Slider: ({ ...props }: any) => React.createElement('input', { type: 'range', ...props }),
    Camera: ({ ...props }: any) => React.createElement('div', props),
    Video: ({ ...props }: any) => React.createElement('video', props),
    Audio: ({ ...props }: any) => React.createElement('audio', props),
    Map: ({ ...props }: any) => React.createElement('div', props),
    Canvas: ({ ...props }: any) => React.createElement('canvas', props),
    WebView: ({ ...props }: any) => React.createElement('iframe', props),
    OpenData: ({ ...props }: any) => React.createElement('div', props),
    Ad: ({ ...props }: any) => React.createElement('div', props),
    AdCustom: ({ ...props }: any) => React.createElement('div', props),
  };
});

// Mock @tarojs/react
jest.mock('@tarojs/react', () => ({
  useRouter: jest.fn(() => ({ path: '/pages/index/index', params: {} })),
  usePageId: jest.fn(() => 'page-1'),
}));
