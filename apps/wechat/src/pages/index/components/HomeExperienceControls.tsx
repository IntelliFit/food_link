import { Text, View } from '@tarojs/components'
import React from 'react'
import {
  HOME_EXPERIENCE_PAGE_ORDER,
  HOME_EXPERIENCE_PAGES,
  type HomeExperiencePageId,
} from '../../../utils/home-experience'

import './HomeExperienceControls.scss'

interface HomeExperienceBarProps {
  activePage: HomeExperiencePageId
  onSelectPage: (pageID: HomeExperiencePageId) => void
}

/** 养生模式内部导航；模式切换统一放在首页右上角。 */
export function HomeExperienceBar({
  activePage,
  onSelectPage,
}: HomeExperienceBarProps): React.ReactElement {
  return (
    <View className='home-experience-nav'>
      <View className='home-experience-nav__tabs'>
        {HOME_EXPERIENCE_PAGE_ORDER.map((pageID) => {
          const page = HOME_EXPERIENCE_PAGES[pageID]
          const active = pageID === activePage
          return (
            <View
              id={`home-experience-tab-${pageID}`}
              key={pageID}
              className={`home-experience-nav__tab${active ? ' is-active' : ''}`}
              onClick={() => onSelectPage(pageID)}
            >
              <Text className={`iconfont ${page.iconClass} home-experience-nav__tab-icon`} />
              <Text className='home-experience-nav__tab-text'>{page.shortName}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
