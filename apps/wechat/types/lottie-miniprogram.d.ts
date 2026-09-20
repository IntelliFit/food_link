declare module 'lottie-miniprogram' {
  export interface LottieAnimation {
    destroy: () => void
  }

  export interface LottieAnimationOptions {
    loop?: boolean
    autoplay?: boolean
    animationData: Record<string, unknown>
    rendererSettings: {
      context: CanvasRenderingContext2D
      clearCanvas?: boolean
    }
  }

  const lottie: {
    setup: (canvas: HTMLCanvasElement) => void
    loadAnimation: (options: LottieAnimationOptions) => LottieAnimation
  }

  export default lottie
}
