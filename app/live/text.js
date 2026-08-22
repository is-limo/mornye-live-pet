'use strict'

function takeCharacters(value, maxLength) {
  return Array.from(String(value || '')).slice(0, maxLength).join('')
}

function collapseText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeNickname(value) {
  const text = collapseText(redactSensitive(value || '观众')).replace(/[<>]/g, '') || '观众'
  return takeCharacters(text, 12) + (Array.from(text).length > 12 ? '…' : '')
}

function sanitizeBarrageText(value, maxLength = 120) {
  return takeCharacters(collapseText(value), maxLength)
}

function redactSensitive(value) {
  return String(value || '')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已隐藏]')
    .replace(/((?:验证码|密码|口令)\s*[:：]?\s*)\d{4,8}/gi, '$1[已隐藏]')
    .replace(/(?<!\d)\d{12,}(?!\d)/g, '[长数字已隐藏]')
}

function sanitizeQueueContent(value) {
  return takeCharacters(collapseText(redactSensitive(value)), 60)
}

function cleanReply(value, maxLength = 45) {
  let text = String(value || '')
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[链接已隐藏]')
    .trim()
    .replace(/^[#>*_`~\-]+\s*/g, '')
    .replace(/^\s*(?:莫宁|assistant|答复|回复)\s*[:：]\s*/i, '')
  text = collapseText(redactSensitive(text))
  text = text.replace(/^["'“”‘’《「『]+|["'“”‘’《「『》」』]+$/g, '').trim()
  return takeCharacters(text, maxLength)
}

module.exports = {
  cleanReply,
  collapseText,
  redactSensitive,
  safeNickname,
  sanitizeBarrageText,
  sanitizeQueueContent,
  takeCharacters,
}
