/* Copied verbatim for native asynchronous resource owners, outside the Taro runtime. */
module.exports = function createIntroMediaOwner(resourceRoot, assets) {
  return {
    options: { virtualHost: true, styleIsolation: 'apply-shared' },
    externalClasses: ['sceneclass'],
    properties: { asset: { type: String, value: '' }, attempt: { type: Number, value: 0 }, motion: { type: Boolean, value: true } },
    lifetimes: { attached() { this._alive = true; }, detached() { this._alive = false; } },
    methods: {
      onPosterLoad() {
        const asset = this.properties.asset, attempt = this.properties.attempt;
        if (!this._alive || !assets[asset]) return;
        this.triggerEvent('posterload', { asset, attempt });
        if (this.properties.motion === false) return;
        try {
          const fs = wx.getFileSystemManager(), spec = assets[asset];
          const src = `${wx.env.USER_DATA_PATH}/fl-intro-${asset}-${spec.revision}.mp4`;
          let valid = false;
          try { valid = fs.statSync(src).size === spec.bytes; } catch (_) { /* Copy only this chapter. */ }
          if (!valid) {
            try { fs.copyFileSync(`/${resourceRoot}/assets/${asset}.mp4`, src); }
            catch (_) { fs.copyFileSync(`${resourceRoot}/assets/${asset}.mp4`, src); }
          }
          if (fs.statSync(src).size !== spec.bytes) throw new Error('动画文件不完整');
          if (this._alive && this.properties.asset === asset && this.properties.attempt === attempt) this.triggerEvent('mediaready', { src, asset, attempt });
        } catch (error) {
          if (this._alive && this.properties.asset === asset && this.properties.attempt === attempt) this.triggerEvent('error', { asset, attempt, errMsg: error.message || '动画文件读取失败' });
        }
      },
      onPosterError(event) { this.triggerEvent('error', { asset: this.properties.asset, attempt: this.properties.attempt, errMsg: event.detail.errMsg || '画面读取失败' }); },
    },
  };
};
