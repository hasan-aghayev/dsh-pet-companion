async function closePet({ persistSettings, hide, onError = () => {} }) {
  try {
    await persistSettings({ visible: false })
  } catch (error) {
    onError(error)
  }
  hide()
}

module.exports = { closePet }
