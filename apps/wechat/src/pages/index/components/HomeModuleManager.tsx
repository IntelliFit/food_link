import { Image, ScrollView, Text, View } from '@tarojs/components'
import * as React from 'react'

import toolboxGourdIcon from '../../../assets/icons/home-toolbox-gourd-golden.webp'
import { HOME_MODULE_DEFINITIONS, type HomeModuleId } from '../utils/homeModuleLayout'

import './HomeModuleManager.scss'

type HomeModuleToolbarProps = {
  editing: boolean
  onOpenToolbox: () => void
  onFinishEditing: () => void
}

export function HomeModuleToolbar({ editing, onOpenToolbox, onFinishEditing }: HomeModuleToolbarProps) {
  if (editing) {
    return (
      <View className='home-module-sort-toolbar'>
        <View className='home-module-sort-status' onClick={onFinishEditing}>
          <View className='home-module-sort-status__dots'><Text>•••</Text></View>
          <View className='home-module-sort-status__copy'>
            <Text className='home-module-sort-status__title'>正在排列首页</Text>
            <Text className='home-module-sort-status__desc'>可继续添加卡片，轻点屏幕完成</Text>
          </View>
        </View>
        <View
          id='home-module-toolbox-button'
          className='home-module-toolbar is-editing'
          ariaLabel='排序中打开功能箱'
          hoverClass='is-pressed'
          hoverStartTime={0}
          hoverStayTime={120}
          onClick={(event) => {
            event?.stopPropagation?.()
            onOpenToolbox()
          }}
        >
          <Image className='home-module-toolbar__icon' src={toolboxGourdIcon} mode='aspectFit' />
        </View>
      </View>
    )
  }

  return (
    <View
      id='home-module-toolbox-button'
      className='home-module-toolbar'
      ariaLabel='打开功能箱'
      hoverClass='is-pressed'
      hoverStartTime={0}
      hoverStayTime={120}
      onClick={(event) => {
        event?.stopPropagation?.()
        onOpenToolbox()
      }}
    >
      <Image className='home-module-toolbar__icon' src={toolboxGourdIcon} mode='aspectFit' />
    </View>
  )
}

type HomeModuleFrameProps = {
  moduleId: HomeModuleId
  label: string
  editing: boolean
  dragging: boolean
  dragOffsetY: number
  layoutOrder: number
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onHide: () => void
  onDragStart: (event: any) => void
  onDragMove: (event: any) => void
  onDragEnd: () => void
  onHoldStart: (event: any) => void
  onHoldMove: (event: any) => void
  onHoldEnd: () => void
  onTapToFinish: () => void
  children: React.ReactNode
}

export function HomeModuleFrame({ moduleId, label, editing, dragging, dragOffsetY, layoutOrder, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onHide, onDragStart, onDragMove, onDragEnd, onHoldStart, onHoldMove, onHoldEnd, onTapToFinish, children }: HomeModuleFrameProps) {
  const touchMovedRef = React.useRef(false)

  return (
    <View
      id={`home-module-${moduleId}`}
      className={`home-module-frame${editing ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}`}
      style={{
        order: layoutOrder,
        ...(dragging ? { transform: `translate3d(0, ${dragOffsetY}px, 0) scale(1.018)` } : {}),
      }}
      catchMove={editing}
      onTouchStart={(event) => {
        touchMovedRef.current = false
        if (editing) onDragStart(event)
        else onHoldStart(event)
      }}
      onTouchMove={(event) => {
        touchMovedRef.current = true
        if (editing) onDragMove(event)
        else onHoldMove(event)
      }}
      onTouchEnd={editing ? onDragEnd : onHoldEnd}
      onTouchCancel={editing ? onDragEnd : onHoldEnd}
      onClick={(event) => {
        if (!editing) return
        event?.stopPropagation?.()
        if (!touchMovedRef.current) onTapToFinish()
        touchMovedRef.current = false
      }}
    >
      {editing && (
        <View className='home-module-frame__editbar'>
          <View className='home-module-frame__drag'>
            <Text className='home-module-frame__drag-icon'>☰</Text>
            <Text>按住卡片拖动 {label}</Text>
          </View>
          <View className='home-module-frame__edit-actions'>
            <View className={`home-module-frame__mini${canMoveUp ? '' : ' is-disabled'}`} onClick={(event) => { event?.stopPropagation?.(); if (canMoveUp) onMoveUp() }}><Text>↑</Text></View>
            <View className={`home-module-frame__mini${canMoveDown ? '' : ' is-disabled'}`} onClick={(event) => { event?.stopPropagation?.(); if (canMoveDown) onMoveDown() }}><Text>↓</Text></View>
            <View className='home-module-frame__hide' onClick={(event) => { event?.stopPropagation?.(); onHide() }}><Text>收纳</Text></View>
          </View>
        </View>
      )}
      <View className={`home-module-frame__content${editing ? ' is-locked' : ''}`}>
        {children}
      </View>
    </View>
  )
}

type HomeToolboxSheetProps = {
  visible: boolean
  visibleIds: HomeModuleId[]
  onAdd: (id: HomeModuleId) => void
  onHide: (id: HomeModuleId) => void
  onReset: () => void
  onClose: () => void
}

export function HomeToolboxSheet({ visible, visibleIds, onAdd, onHide, onReset, onClose }: HomeToolboxSheetProps) {
  if (!visible) return null
  const visibleSet = new Set(visibleIds)

  return (
    <View className='home-toolbox' onClick={(event) => event?.stopPropagation?.()}>
      <View className='home-toolbox__mask' onClick={onClose} />
      <View className='home-toolbox__sheet'>
        <View className='home-toolbox__header'>
          <View className='home-toolbox__heading'>
            <Image className='home-toolbox__heading-icon' src={toolboxGourdIcon} mode='aspectFit' />
            <View>
              <Text className='home-toolbox__title'>功能箱</Text>
              <Text className='home-toolbox__subtitle'>把常用模块放在首页，不常用的先收起来</Text>
            </View>
          </View>
          <View className='home-toolbox__close' onClick={onClose}><Text>×</Text></View>
        </View>
        <ScrollView scrollY className='home-toolbox__scroll'>
          <View className='home-toolbox__summary'>
            <Text>首页 {visibleIds.length} 个</Text>
            <Text>已收纳 {HOME_MODULE_DEFINITIONS.length - visibleIds.length} 个</Text>
          </View>
          <View className='home-toolbox__grid'>
            {HOME_MODULE_DEFINITIONS.map((module) => {
              const isVisible = visibleSet.has(module.id)
              return (
                <View
                  key={module.id}
                  id={`home-toolbox-item-${module.id}`}
                  className={`home-toolbox__item${isVisible ? ' is-visible' : ''}`}
                  style={{
                    '--home-module-accent': module.accent,
                    '--home-module-tint': module.tint,
                  } as React.CSSProperties}
                >
                  <View className='home-toolbox__item-main'>
                    <View className='home-toolbox__item-icon' ariaLabel={`${module.label}标识`}>
                      <Text className={`iconfont ${module.iconClass}`} />
                    </View>
                    <View className='home-toolbox__item-copy'>
                      <Text className='home-toolbox__item-title'>{module.label}</Text>
                      <Text className='home-toolbox__item-desc'>{module.description}</Text>
                    </View>
                  </View>
                  <View className={`home-toolbox__item-action${isVisible ? ' is-remove' : ''}`} onClick={() => isVisible ? onHide(module.id) : onAdd(module.id)}>
                    <Text>{isVisible ? '收纳' : '+ 添加'}</Text>
                  </View>
                </View>
              )
            })}
          </View>
          <View className='home-toolbox__reset' onClick={onReset}><Text>恢复默认布局</Text></View>
        </ScrollView>
      </View>
    </View>
  )
}
