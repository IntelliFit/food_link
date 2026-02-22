import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Cell } from '@taroify/core'
import '@taroify/core/cell/style'
import '@taroify/icons/style'
import './index.scss'

export default function AboutPage() {
    const APP_LOGO_URL = 'https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/icon/shitan-nobackground.png'

    const OFFICIAL_EMAIL = 'jianwen_ma@stu.pku.edu.cn'

    const handleCopyEmail = () => {
        Taro.setClipboardData({
            data: OFFICIAL_EMAIL,
            success: () => {
                Taro.showToast({ title: '已复制邮箱', icon: 'success' })
            }
        })
    }

    return (
        <View className="about-page">
            <View className="header-section">
                <View className="logo-wrapper">
                    <Image className="logo-image" src={APP_LOGO_URL} mode="aspectFit" />
                </View>
                <Text className="app-name">智健食探</Text>
                <Text className="app-version">Version 1.0.0</Text>
            </View>

            <View className="content-section">
                <View className="card">
                    <Text className="card-title">关于食探</Text>
                    <Text className="card-text">
                        「食探」是一款致力于帮助用户通过拍照识别食物卡路里、记录日常饮食与运动、管理健康档案的智能助手。我们希望通过 AI 技术，让健康管理变得更加简单、有趣且高效。无论你是想减脂、增肌还是维持健康，食探都能为你提供专业的分析与建议。
                    </Text>
                </View>

                <View className="cell-group">
                    <Cell title="官方邮箱" clickable isLink onClick={handleCopyEmail}>
                        <Text className="cell-value">{OFFICIAL_EMAIL}</Text>
                    </Cell>
                </View>

                <View className="card">
                    <Text className="card-title">特别鸣谢</Text>
                    <Text className="card-text">
                        感谢所有用户的支持与反馈，正是你们的建议让食探变得更好。如有任何问题或建议，欢迎随时通过意见反馈或联系客服告诉我们。
                    </Text>
                </View>
            </View>

            <View className="footer-copyright">
                <Text className="copyright-text">Copyright © 2026 Food Link. All Rights Reserved.</Text>
            </View>
        </View>
    )
}
