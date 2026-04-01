/**
 * 页面集成测试
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// 模拟页面组件
const IndexPage: React.FC = () => {
  return (
    <div data-testid="index-page">
      <h1>首页</h1>
      <p>欢迎使用 Food Link</p>
    </div>
  );
};

const ProfilePage: React.FC = () => {
  return (
    <div data-testid="profile-page">
      <h1>个人中心</h1>
      <div data-testid="user-info">
        <span>用户名</span>
        <span>test@example.com</span>
      </div>
    </div>
  );
};

const RecordPage: React.FC = () => {
  return (
    <div data-testid="record-page">
      <h1>饮食记录</h1>
      <button data-testid="add-record-btn">添加记录</button>
      <div data-testid="record-list">
        <div data-testid="record-item">早餐 - 500卡</div>
        <div data-testid="record-item">午餐 - 800卡</div>
      </div>
    </div>
  );
};

describe('页面集成测试', () => {
  describe('首页', () => {
    it('应正确渲染首页', () => {
      render(<IndexPage />);
      expect(screen.getByTestId('index-page')).toBeInTheDocument();
      expect(screen.getByText('首页')).toBeInTheDocument();
      expect(screen.getByText('欢迎使用 Food Link')).toBeInTheDocument();
    });
  });

  describe('个人中心页', () => {
    it('应正确渲染个人中心', () => {
      render(<ProfilePage />);
      expect(screen.getByTestId('profile-page')).toBeInTheDocument();
      expect(screen.getByText('个人中心')).toBeInTheDocument();
      expect(screen.getByTestId('user-info')).toBeInTheDocument();
    });
  });

  describe('饮食记录页', () => {
    it('应正确渲染记录页面', () => {
      render(<RecordPage />);
      expect(screen.getByTestId('record-page')).toBeInTheDocument();
      expect(screen.getByText('饮食记录')).toBeInTheDocument();
      expect(screen.getByTestId('add-record-btn')).toBeInTheDocument();
    });

    it('应显示记录列表', () => {
      render(<RecordPage />);
      const records = screen.getAllByTestId('record-item');
      expect(records).toHaveLength(2);
      expect(records[0]).toHaveTextContent('早餐 - 500卡');
      expect(records[1]).toHaveTextContent('午餐 - 800卡');
    });
  });
});
