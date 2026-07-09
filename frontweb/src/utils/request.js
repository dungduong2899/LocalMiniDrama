import axios from 'axios'
import { ElMessage } from 'element-plus'

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 600000,
  headers: { 'Content-Type': 'application/json' }
})

request.interceptors.response.use(
  (response) => {
    // blob response trả về nguyên dữ liệu, không unwrap JSON
    if (response.config?.responseType === 'blob') {
      return response.data
    }
    const res = response.data
    if (res.success !== false) {
      return res.data !== undefined ? res.data : res
    }
    return Promise.reject(new Error(res.error?.message || 'Request thất bại'))
  },
  (error) => {
    // Ưu tiên message thực từ backend thay vì message chung của axios "status code 500"
    const backendMsg = error.response?.data?.error?.message
    const msg = backendMsg || error.message || 'Lỗi mạng'
    ElMessage.error(msg)
    // Ghi lại message thực để component có thể dùng e.message trực tiếp
    if (backendMsg) error.message = backendMsg
    return Promise.reject(error)
  }
)

export default request
