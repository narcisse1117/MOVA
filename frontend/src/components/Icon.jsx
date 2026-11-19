import arrowRight from '../assets/icons/arrow-right.svg'
import chevronDown from '../assets/icons/chevron-down.svg'
import chevronLeft from '../assets/icons/chevron-left.svg'
import chevronRight from '../assets/icons/chevron-right.svg'
import close from '../assets/icons/close.svg'
import locate from '../assets/icons/locate.svg'
import menu from '../assets/icons/menu.svg'
import swapVertical from '../assets/icons/swap-vertical.svg'
import styles from './Icon.module.css'

const ICONS = {
  'arrow-right': arrowRight,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  close,
  locate,
  menu,
  'swap-vertical': swapVertical,
}

/**
 * src/assets/icons의 SVG를 아이콘으로 표시.
 * SVG를 마스크로 써서 글자색(currentColor)을 그대로 따라가므로, 부모의 color만 바꾸면 아이콘 색도 바뀐다.
 * 새 아이콘은 같은 폴더에 24×24 SVG를 넣고 위 ICONS에 등록하면 된다.
 *
 * @param {keyof ICONS} name
 * @param {number} [size=20] px
 * @param {string} [label] 아이콘만 있는 버튼이 아니면 비워 둠 (읽지 않음)
 */
export default function Icon({ name, size = 20, label, className = '' }) {
  return (
    <span
      className={`${styles.icon} ${className}`}
      style={{ '--icon': `url("${ICONS[name]}")`, '--size': `${size}px` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
