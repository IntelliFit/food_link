import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import {
    FireOutlined
} from '@taroify/icons'
import { Cell } from '@taroify/core'
import '@taroify/core/cell/style'
import '@taroify/icons/style'
import './index.scss'

export default function AboutPage() {

    const handleCopyWeChat = () => {
        Taro.setClipboardData({
            data: 'food_link_official',
            success: () => {
                Taro.showToast({ title: '已复制微信号', icon: 'success' })
            }
        })
    }

    return (
        <View className="about-page">
            <View className="header-section">
                <View className="logo-wrapper">
                    <FireOutlined size="48" color="#fff" />
                </View>
                <Text className="app-name">食探</Text>
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
                    <Cell title="用户协议" clickable isLink />
                    <Cell title="隐私政策" clickable isLink />
                    <Cell title="官方微信" clickable isLink onClick={handleCopyWeChat}>
                        <Text style={{ color: '#9ca3af', fontSize: '14px' }}>food_link_official</Text>
                    </Cell>
                    <Cell title="联系客服" clickable isLink />
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
