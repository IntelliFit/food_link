import { Text, View } from '@tarojs/components'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { withAuth } from '../../../utils/withAuth'
import { OwnCommentHistory } from '../../components/OwnCommentHistory'
import './index.scss'

function CommentHistoryPage() {
  return (
    <FlPageThemeRoot><View className='comment-history-page'>
      <Text className='comment-history-heading'>我的评论</Text>
      <Text className='comment-history-caption'>你发过的评论和回复</Text>
      <OwnCommentHistory />
    </View></FlPageThemeRoot>
  )
}

export default withAuth(CommentHistoryPage)
