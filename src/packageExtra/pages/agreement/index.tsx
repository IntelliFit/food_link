import { View, Text, ScrollView } from '@tarojs/components'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import './index.scss'

export default function AgreementPage() {
    return (
        <FlPageThemeRoot>
        <ScrollView scrollY className='agreement-page'>
            <View className='document-content'>
                <Text className='title'>用户服务协议</Text>
                <Text className='update-time'>最后更新日期：2026年02月</Text>

                <View className='section'>
                    <Text className='section-title'>一、协议的范围</Text>
                    <Text className='paragraph'>
                        欢迎您使用“智健食探”微信小程序（以下简称“本小程序”）。本协议是您与本小程序运营方之间关于您使用本小程序服务所订立的协议。请您务必审慎阅读、充分理解各条款内容。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>二、服务内容</Text>
                    <Text className='paragraph'>
                        1. 本小程序通过AI视觉识别和大型语言模型技术，为您提供饮食营养记录、卡路里分析、健康数据打卡、社区交流等相关健康管理服务。
                    </Text>
                    <Text className='paragraph'>
                        2. 本小程序提供的识别结果、建议仅供参考，不能替代专业医疗诊断及医生的治疗建议。如您有疾病或特殊健康状况，请务必遵从专业医生的指导。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>三、用户行为规范</Text>
                    <Text className='paragraph'>
                        1. 您应当保证您在使用本小程序服务时所上传的图片、文字等信息不违反国家法律法规，不侵犯任何第三方的合法权益。
                    </Text>
                    <Text className='paragraph'>
                        2. 本小程序倡导健康的社区交流，禁止发布色情、暴力、诱导分享、虚假营销等违规内容。一经发现，我们有权对您的账号进行封禁、删除内容等处理。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>四、知识产权</Text>
                    <Text className='paragraph'>
                        本小程序包含的任何文字、图片、音频、视频、软件设计及商标等知识产权均归本小程序及其关联公司所有，未经授权严禁以任何形式使用、复制、传播。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>五、免责声明</Text>
                    <Text className='paragraph'>
                        因不可抗力、网络故障、第三方服务中断等原因导致本小程序无法正常服务，我们不承担因此给您带来的损失。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>六、会员与积分服务</Text>
                    <Text className='paragraph'>
                        1. 本小程序提供三档会员套餐，分别为轻度版（每日 8 积分）、标准版（每日 20 积分）和进阶版（每日 40 积分）。不同档位的每日系统积分额度不同，您可根据自身使用频率选择适合的套餐。
                    </Text>
                    <Text className='paragraph'>
                        2. 标准版及以上套餐支持「精准模式」，该模式下 AI 会对食物照片进行更准确的分项估算，适合有减脂或增肌目标的用户；轻度版仅支持「标准模式」。
                    </Text>
                    <Text className='paragraph'>
                        3. 系统积分每日自动发放至您的账户，次日 00:00 刷新清零。通过邀请好友、生成分享海报等行为获得的奖励积分将计入累计余额，长期有效、不清零。
                    </Text>
                    <Text className='paragraph'>
                        4. 创始用户礼遇：前 1000 名注册用户或前 100 名付费用户，在开通会员后可享受每日套餐积分翻倍的礼遇，具体以页面展示为准。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>七、付费与订阅</Text>
                    <Text className='paragraph'>
                        1. 会员套餐提供月卡、季卡、年卡三种订阅周期，价格以页面实时展示为准。长期订阅通常享有更优惠的单价。
                    </Text>
                    <Text className='paragraph'>
                        2. 支付成功后，会员权益即时生效。您可随时在当前套餐基础上升级档位或切换周期，按页面提示完成补差即可。
                    </Text>
                    <Text className='paragraph'>
                        3. 所有会员套餐到期后均不自动续费，如需继续使用请在到期前手动续费。到期未续费将自动恢复为免费额度。
                    </Text>
                    <Text className='paragraph'>
                        4. 本小程序支持微信支付。因网络异常、支付渠道限制等导致的支付失败，请联系客服协助处理。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>八、奖励积分规则</Text>
                    <Text className='paragraph'>
                        1. 邀请好友：您通过专属邀请码邀请的好友，在注册后 7 天内完成 2 个自然日的有效使用，您与好友双方将各获得 15 奖励积分，自动转入累计余额。
                    </Text>
                    <Text className='paragraph'>
                        2. 每日分享：将饮食分析结果生成分享海报并分享，每日首次分享可获得 1 奖励积分，计入累计余额。
                    </Text>
                    <Text className='paragraph'>
                        3. 积分消耗参考：运动记录约 1 积分/次，基础饮食记录或基础分析约 2 积分/次，精准模式分析根据实际调用情况扣除相应积分。
                    </Text>
                    <Text className='paragraph'>
                        4. 我们保留调整积分获取与消耗规则的权利，如涉及重大变更将提前在小程序内公示。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>九、账号注销</Text>
                    <Text className='paragraph'>
                        1. 您有权随时注销本小程序账号。注销后，您的本地缓存数据、登录状态将被清除，您将无法继续使用本小程序的个性化服务。
                    </Text>
                    <Text className='paragraph'>
                        2. 账号注销后，您在本小程序产生的健康记录、饮食分析历史、社交关系等数据将依据相关法律法规及本隐私政策的规定进行处理。
                    </Text>
                    <Text className='paragraph'>
                        3. 如您有未完成的会员订阅或 pending 中的积分兑换，建议在处理完毕后再进行注销操作。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>十、协议的变更</Text>
                    <Text className='paragraph'>
                        我们可能会根据业务发展适时修订本协议内容。修订后的协议将在小程序内以适当方式公示，继续使用本服务视为您已接受修订后的协议。如您不同意修订内容，可选择停止使用并注销账号。
                    </Text>
                </View>
            </View>
        </ScrollView>
        </FlPageThemeRoot>
    )
}
