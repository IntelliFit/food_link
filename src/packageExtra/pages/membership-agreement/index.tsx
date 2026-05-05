import { View, Text, ScrollView } from '@tarojs/components'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import './index.scss'

export default function MembershipAgreementPage() {
    return (
        <FlPageThemeRoot>
        <ScrollView scrollY className='membership-agreement-page'>
            <View className='document-content'>
                <Text className='title'>会员服务协议</Text>
                <Text className='update-time'>最后更新日期：2026年05月</Text>

                <View className='section'>
                    <Text className='section-title'>一、服务说明</Text>
                    <Text className='paragraph'>
                        1. 本协议是您（以下简称「用户」）与「智健食探」微信小程序（以下简称「本小程序」）运营方之间，就您购买和使用本小程序会员服务所订立的协议。请您在购买前仔细阅读本协议的全部内容。
                    </Text>
                    <Text className='paragraph'>
                        2. 会员服务是本小程序向用户提供的增值订阅服务，购买会员后您可享受相应的每日积分额度和功能权益。会员服务不影响本小程序免费基础功能的使用。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>二、会员档位与权益</Text>
                    <Text className='paragraph'>
                        1. 本小程序提供三档会员套餐，用户可根据自身使用需求选择：
                    </Text>
                    <Text className='paragraph'>
                        · 轻度版：每日 8 积分，适合轻量记录需求的用户，不含精准模式；
                    </Text>
                    <Text className='paragraph'>
                        · 标准版：每日 20 积分，含精准模式，适合日常饮食记录需求的用户；
                    </Text>
                    <Text className='paragraph'>
                        · 进阶版：每日 40 积分，含精准模式，适合高频记录或有精细管理需求的用户。
                    </Text>
                    <Text className='paragraph'>
                        2. 「精准模式」与「标准模式」的区别：精准模式下，AI 会对食物照片进行更准确的分项重量估算，适合有减脂或增肌目标的用户；标准模式记录更便捷，但估算误差相对更大。轻度版不含精准模式。
                    </Text>
                    <Text className='paragraph'>
                        3. 系统积分每日自动发放至您的账户，次日 00:00 刷新清零。通过邀请好友、生成分享海报等行为获得的奖励积分将计入累计余额，长期有效、不清零。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>三、订阅周期与费用</Text>
                    <Text className='paragraph'>
                        1. 会员套餐提供月卡、季卡、年卡三种订阅周期，具体价格以购买页面实时展示为准。长期订阅通常享有更优惠的单价，购买页面会明确标注相较月卡的节省金额。
                    </Text>
                    <Text className='paragraph'>
                        2. 支付成功后，会员权益即时生效。本小程序支持微信支付，因网络异常、支付渠道限制等导致的支付失败，请联系客服协助处理。
                    </Text>
                    <Text className='paragraph'>
                        3. 所有会员套餐到期后均不自动续费。如需继续使用，请在到期前手动续费。到期未续费将自动恢复为免费额度，已累积的奖励积分余额不受影响。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>四、升级与切换</Text>
                    <Text className='paragraph'>
                        1. 在会员有效期内，您可随时在当前套餐基础上升级档位（如从轻度版升级到标准版或进阶版），或切换订阅周期，按页面提示完成补差即可。
                    </Text>
                    <Text className='paragraph'>
                        2. 升级档位后，新的每日积分额度将于次日 00:00 起按新档位发放。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>五、创始用户礼遇</Text>
                    <Text className='paragraph'>
                        1. 为感谢早期用户的支持，本小程序面向前 1000 名注册用户或前 100 名付费用户提供创始用户礼遇：开通会员后，每日系统积分按所购套餐额度的双倍发放。
                    </Text>
                    <Text className='paragraph'>
                        2. 创始用户礼遇的具体资格以您账号注册时系统记录的排名为准，可在会员中心页面查看您的礼遇状态。
                    </Text>
                    <Text className='paragraph'>
                        3. 创始用户礼遇与会员套餐绑定，仅在会员有效期内生效。若会员到期未续费，礼遇权益将暂停，重新开通后可恢复。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>六、奖励积分规则</Text>
                    <Text className='paragraph'>
                        1. 邀请好友：您通过专属邀请码邀请的好友，在注册后 7 天内完成 2 个自然日的有效使用，您与好友双方将各获得 15 奖励积分，自动转入累计余额。
                    </Text>
                    <Text className='paragraph'>
                        2. 每日分享：将饮食分析结果生成分享海报并分享，每日首次分享可获得 1 奖励积分，计入累计余额。
                    </Text>
                    <Text className='paragraph'>
                        3. 积分消耗参考：运动记录约 1 积分/次，基础饮食记录或基础分析约 2 积分/次，精准模式分析根据实际 AI 推理调用情况扣除相应积分。
                    </Text>
                    <Text className='paragraph'>
                        4. 我们保留调整积分获取与消耗规则的权利，如涉及重大变更将提前在小程序内公示，已获得的奖励积分余额不受影响。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>七、退款与取消</Text>
                    <Text className='paragraph'>
                        1. 会员服务属于虚拟订阅服务，支付成功后原则上不支持退款。如存在支付异常、重复扣款等特殊情况，请联系客服核实处理。
                    </Text>
                    <Text className='paragraph'>
                        2. 由于本小程序所有套餐均为到期不自动续费，您无需主动「取消订阅」，到期后如不手动续费即自动终止。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>八、服务变更与中断</Text>
                    <Text className='paragraph'>
                        1. 因系统维护、升级或不可抗力因素，我们可能需要暂时中断会员服务，届时将尽可能提前通知。
                    </Text>
                    <Text className='paragraph'>
                        2. 如因运营策略调整需要变更会员权益内容，我们将提前在小程序内公示，已购买且在有效期内的用户权益不受影响。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>九、争议解决</Text>
                    <Text className='paragraph'>
                        如您对会员服务有任何疑问或争议，可通过小程序内的客服入口或相关反馈通道与我们联系协商解决。
                    </Text>
                </View>
            </View>
        </ScrollView>
        </FlPageThemeRoot>
    )
}
