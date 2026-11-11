import { View, Text, ScrollView } from '@tarojs/components'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import './index.scss'

export default function PrivacyPage() {
    return (
        <FlPageThemeRoot>
        <ScrollView scrollY className='document-page'>
            <View className='document-content'>
                <Text className='title'>隐私政策</Text>
                <Text className='update-time'>最后更新日期：2026年11月</Text>

                <View className='section'>
                    <Text className='section-title'>引言</Text>
                    <Text className='paragraph'>
                        “智健食探”深知个人信息对您的重要性，并会遵循合法、正当、必要的原则，依法采取相应的安全保护措施，尽力保护您的个人信息安全可控。本隐私政策适用于您对本微信小程序的使用。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>一、我们如何收集和使用您的信息</Text>
                    <Text className='paragraph'>
                        1. 微信授权：在征得您的同意后，为了给您配置个性化的健康档案和社交互动能力，我们会收取您的微信头像、昵称等公开信息。
                    </Text>
                    <Text className='paragraph'>
                        2. 数据和照片：当您使用“记录”或“分析”功能时，为了实现AI卡路里分析与识别，您主动上传或拍摄的食物照片、体检报告将上传至我们的服务器供大语言模型(LLM)进行推理分析。我们不会将您的这些敏感个人健康和图片信息用于分析服务之外的其他商业用途。
                    </Text>
                    <Text className='paragraph'>
                        3. 身体数据：我们收集您的身高、体重、病史等身体指标，这是为了更智能和准确地向您提供“饮食建议”与“PFC比例分析”的核心服务支撑。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>二、我们如何存储您的个人信息</Text>
                    <Text className='paragraph'>
                        1. 保存地域：我们在中华人民共和国境内收集和产生的个人信息，将存储在中国境内。
                    </Text>
                    <Text className='paragraph'>
                        2. 存储期限：我们仅在为您提供服务之目的所必需的合理期限内，或法律法规所要求的期限内保留您的个人信息。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>三、我们如何共享、转让和公开披露</Text>
                    <Text className='paragraph'>
                        除法律法规规定及得到您的单独同意外，我们不会向任何第三方共享、转让、出售您的隐私信息。
                    </Text>
                    <Text className='paragraph'>
                        您保存的饮食、运动等记录（包括照片）和圈子动态默认对所有用户公开，包括未登录的访客，其他用户同时能看到您的昵称和头像。您第一次保存记录后，我们会在小程序内提醒您。
                    </Text>
                    <Text className='paragraph'>
                        您可以随时在“我的-隐私设置”中关闭“允许陌生人看到”，关闭后只有与您互相添加为好友的用户能看到；也可以再关闭“互相好友可以看到”，只有您自己能看到。关闭期间保存的记录，之后重新开启也不会展示。
                    </Text>
                    <Text className='paragraph'>
                        当您主动把某条记录分享给他人时，收到链接的人可以查看这条记录。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>四、账号注销与个人信息删除</Text>
                    <Text className='paragraph'>
                        您可通过账号安全或个人资料进入注销页，选择7天冷静期或立即注销。申请后账号暂停正常使用，冷静期内仅保留查看状态和明确撤销等必要能力。打开或登录不会自动撤销，截止后自动开始永久清理。
                    </Text>
                    <Text className='paragraph'>
                        永久清理将处理账号资料、健康记录、照片和社交关联；依法需保留的最小交易与安全凭证单独存储并限制用途。共享资料、外部存储与备份依据适用规则处理，不承诺所有副本即时消失。
                    </Text>
                </View>

                <View className='section'>
                    <Text className='section-title'>五、如何联系我们</Text>
                    <Text className='paragraph'>
                        如果您对本隐私政策或个人信息保护有任何疑问、意见或建议，请通过本程序内的客服入口或相关反馈通道与我们联系。
                    </Text>
                </View>
            </View>
        </ScrollView>
        </FlPageThemeRoot>
    )
}
