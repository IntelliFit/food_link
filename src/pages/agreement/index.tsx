import { View, Text, ScrollView } from '@tarojs/components'
import './index.scss'

export default function AgreementPage() {
    return (
        <ScrollView scrollY className="agreement-page">
            <View className="document-content">
                <Text className="title">用户服务协议</Text>
                <Text className="update-time">最后更新日期：2026年02月</Text>

                <View className="section">
                    <Text className="section-title">一、协议的范围</Text>
                    <Text className="paragraph">
                        欢迎您使用“智健食探”微信小程序（以下简称“本小程序”）。本协议是您与本小程序运营方之间关于您使用本小程序服务所订立的协议。请您务必审慎阅读、充分理解各条款内容。
                    </Text>
                </View>

                <View className="section">
                    <Text className="section-title">二、服务内容</Text>
                    <Text className="paragraph">
                        1. 本小程序通过AI视觉识别和大型语言模型技术，为您提供饮食营养记录、卡路里分析、健康数据打卡、社区交流等相关健康管理服务。
                    </Text>
                    <Text className="paragraph">
                        2. 本小程序提供的识别结果、建议仅供参考，不能替代专业医疗诊断及医生的治疗建议。如您有疾病或特殊健康状况，请务必遵从专业医生的指导。
                    </Text>
                </View>

                <View className="section">
                    <Text className="section-title">三、用户行为规范</Text>
                    <Text className="paragraph">
                        1. 您应当保证您在使用本小程序服务时所上传的图片、文字等信息不违反国家法律法规，不侵犯任何第三方的合法权益。
                    </Text>
                    <Text className="paragraph">
                        2. 本小程序倡导健康的社区交流，禁止发布色情、暴力、诱导分享、虚假营销等违规内容。一经发现，我们有权对您的账号进行封禁、删除内容等处理。
                    </Text>
                </View>

                <View className="section">
                    <Text className="section-title">四、知识产权</Text>
                    <Text className="paragraph">
                        本小程序包含的任何文字、图片、音频、视频、软件设计及商标等知识产权均归本小程序及其关联公司所有，未经授权严禁以任何形式使用、复制、传播。
                    </Text>
                </View>

                <View className="section">
                    <Text className="section-title">五、免责声明</Text>
                    <Text className="paragraph">
                        因不可抗力、网络故障、第三方服务中断等原因导致本小程序无法正常服务，我们不承担因此给您带来的损失。
                    </Text>
                </View>
            </View>
        </ScrollView>
    )
}
