/** Stand-in for components/SaveButton in hook-runtime tests: a plain button and a feedback hook without timers. */
export const saveButtonMock = Object.freeze({
  SaveButton: 'button',
  useSaveFeedback: () => ({ saved: false, markSaved() {}, reset() {} }),
})
