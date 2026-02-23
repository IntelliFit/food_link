import { View, Text, ScrollView } from '@tarojs/components'
import './index.scss'

export default function PrivacyPage() {
    return (
        <ScrollView scrollY className="document-page">
            <View className="document-content">
                <Text className="title">隐私政策</Text>
                <Text className="update-time">最后更新日期：2026年02月</Text>

                <View className="section">
                    <Text className="section-title">引言</Text>
                    <Text className="paragraph">
                        “智健食探”深知个人信息对您的重要性，并会遵循合法、正当、必要的原则，依法采取相应的安全保护措施，尽力保护您的个人信息安全可控。本隐私政策适用于您对本微信小程序的使用。
                    </Text>
                </View>

                <View className="section">
                    <Text className="section-title">一、我们如何收集和使用您的信息</Text>
                    <Text className="paragraph">
                        1. 微信授权：在征得您的同意后，为了给您配置个性化的健康档案和社交互动能力，我们会收取您的微信头像、昵称等公开信息。
                    </Text>
                    <Text className="paragraph">
                        2. 数据和照片：当您使用“记录”或“分析”功能时，为了实现AI卡路里分析与识别，您主动上传或拍摄的食物照片、体检报告将上传至我们的服务器供大语言模型(LLM)进行推理分析。我们不会将您的这些敏感个人健康和图片信息用于分析服务之外的其他商业用途。
                    </Text>
                    <Text className="paragraph">
                        3. 身体数据：我们收集您的身高、体重、病史等身体指标，这是为了更智能和准确地向您提供“饮食建议”与“PFC比例分析”的核心服务支撑。
                    </Text>
                </View>

                <View className="section">
                    <Text className="section-title">二、我们如何存储您的个人信息</Text>
                    <Text className="paragraph">
                        1. 保存地域：我们在中华人民共和国境内收集和产生的个人信息，将存储在中国境内。
                    </Text>
                    <Text className="paragraph">
                        2. 存储期限：我们仅在为您提供服务之目的所必需的合理期限内，或法律法规所要求的期限内保留您的个人信息。
                    </Text>
                </View>

                <View className="section">
                    <Text className="section-title">三、我们如何共享、转让和公开披露</Text>
                    <Text className="paragraph">
                        除法律法规规定及得到您的单独同意外，我们不会向任何第三方共享、转让、出售您的隐私信息。
                    </Text>
                    <Text className="paragraph">
                        当您选择在“圈子”或“动态”中公开您的健康食谱或照片时，您的昵称和这些主动分享的内容将对其他用户可见。
                    </Text>
                </View>

                <View className="section">
                    <Text className="section-title">四、如何联系我们</Text>
                    <Text className="paragraph">
                        如果您对本隐私政策或个人信息保护有任何疑问、意见或建议，请通过本程序内的客服入口或相关反馈通道与我们联系。
                    </Text>
                </View>
            </View>
        </ScrollView>
    )
}
