/**
 * API 工具函数单元测试
 */

// 模拟 API 请求工具
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.example.com';

interface ApiResponse<T> {
  data: T;
  status: number;
  message?: string;
}

// 模拟请求函数
const request = async <T>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> => {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || '请求失败');
  }

  return {
    data,
    status: response.status,
  };
};

// 模拟 API 方法
const api = {
  get: <T>(url: string) => request<T>(url, { method: 'GET' }),
  post: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};

describe('API 工具函数', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('GET 请求', () => {
    it('应正确发送 GET 请求', async () => {
      const mockData = { id: 1, name: 'Test' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      });

      const result = await api.get('/users/1');

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/users/1`,
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(result.data).toEqual(mockData);
      expect(result.status).toBe(200);
    });
  });

  describe('POST 请求', () => {
    it('应正确发送 POST 请求', async () => {
      const mockData = { id: 1, name: 'New User' };
      const requestBody = { name: 'New User' };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockData,
      });

      const result = await api.post('/users', requestBody);

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/users`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody),
        })
      );
      expect(result.data).toEqual(mockData);
      expect(result.status).toBe(201);
    });
  });

  describe('错误处理', () => {
    it('应在响应失败时抛出错误', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      });

      await expect(api.get('/users/999')).rejects.toThrow('Not Found');
    });
  });
});
