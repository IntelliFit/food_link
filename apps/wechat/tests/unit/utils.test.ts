/**
 * 工具函数单元测试
 */

// 简单测试本地工具函数
const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

describe('工具函数测试', () => {
  describe('formatDate', () => {
    it('应正确格式化日期', () => {
      const date = new Date('2024-03-15');
      expect(formatDate(date)).toBe('2024-03-15');
    });

    it('应正确处理月份和日期补零', () => {
      const date = new Date('2024-01-05');
      expect(formatDate(date)).toBe('2024-01-05');
    });
  });

  describe('clamp', () => {
    it('应正确限制在范围内', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('应正确处理低于最小值的情况', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('应正确处理高于最大值的情况', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('应正确处理边界值', () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });
});
