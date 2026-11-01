// true on phone-width screens (same breakpoint as the CSS: 720px)
import { ref } from 'vue'

export const isPhone = ref(false)
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(max-width: 720px)')
  isPhone.value = mq.matches
  mq.addEventListener('change', (e) => { isPhone.value = e.matches })
}
