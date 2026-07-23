import {
  isVirtualPaymentCancellation,
  requestVirtualPaymentAndWait,
} from '../../src/utils/virtual-payment'

const paymentOptions = {
  signData: '{"offerId":"offer"}',
  paySig: 'pay-signature',
  signature: 'user-signature',
  mode: 'short_series_goods',
}

describe('requestVirtualPaymentAndWait', () => {
  it('does not continue when the native API only opens the payment sheet', async () => {
    let callbacks: any
    const invoker = jest.fn((options) => {
      callbacks = options
      return undefined
    })

    const payment = requestVirtualPaymentAndWait(invoker, paymentOptions)
    const stateBeforeCallback = await Promise.race([
      payment.then(() => 'settled'),
      Promise.resolve('pending'),
    ])

    expect(stateBeforeCallback).toBe('pending')
    callbacks.success({ errMsg: 'requestVirtualPayment:ok' })
    await expect(payment).resolves.toEqual({ errMsg: 'requestVirtualPayment:ok' })
  })

  it('rejects when the user cancels the native payment sheet', async () => {
    const cancellation = { errCode: -2, errMsg: 'requestVirtualPayment:fail cancel' }
    const invoker = jest.fn((options) => options.fail(cancellation))

    await expect(requestVirtualPaymentAndWait(invoker, paymentOptions)).rejects.toBe(cancellation)
    expect(isVirtualPaymentCancellation(cancellation)).toBe(true)
  })

  it('rejects unsupported clients before creating a payment flow', async () => {
    await expect(requestVirtualPaymentAndWait(undefined, paymentOptions))
      .rejects
      .toThrow('当前微信版本暂不支持虚拟支付')
  })
})
