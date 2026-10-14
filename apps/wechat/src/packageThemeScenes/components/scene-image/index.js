/* The image must be rendered by a component in its own resource package. */
Component({
  options: { virtualHost: true, styleIsolation: 'apply-shared' },
  externalClasses: ['sceneclass'],
  properties: {
    asset: { type: String, value: '' },
    mode: { type: String, value: 'scaleToFill' },
  },
  methods: {
    onLoad(event) { this.triggerEvent('load', event.detail); },
    onError(event) {
      console.warn('[theme-scenes] image unavailable:', this.properties.asset, event.detail.errMsg);
      try {
        const asset = this.properties.asset;
        if (/^[a-z0-9-]+\.webp$/.test(asset)) {
          wx.getFileSystemManager().access({
            path: `packageThemeScenes/assets/${asset}`,
            success: () => console.info('[theme-scenes] packaged file available:', asset),
            fail: error => console.warn('[theme-scenes] packaged file unavailable:', asset, error.errMsg),
          });
        }
      } catch (error) { console.warn('[theme-scenes] file check unavailable:', error.message); }
      this.triggerEvent('error', event.detail);
    },
  },
});
