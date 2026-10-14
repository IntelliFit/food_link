/* The image must be rendered by a component in its own resource package. */
Component({
  options: { virtualHost: true, styleIsolation: 'apply-shared' },
  externalClasses: ['sceneclass'],
  properties: {
    asset: { type: String, value: '' },
    mode: { type: String, value: 'scaleToFill' },
  },
  data: { imageSrc: '' },
  observers: {
    asset(asset) {
      this.setData({ imageSrc: /^[a-z0-9-]+\.webp$/.test(asset) ? `packageThemeScenes/assets/${asset}` : '' });
    },
  },
  methods: {
    onLoad(event) { this.triggerEvent('load', event.detail); },
    onError(event) {
      console.warn('[theme-scenes] image unavailable:', this.properties.asset, event.detail.errMsg);
      this.triggerEvent('error', event.detail);
    },
  },
});
