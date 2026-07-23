type CapabilitySwitchProps = {
  checked: boolean
  label: string
  onChange: () => void
}

function CapabilitySwitch({
  checked,
  label,
  onChange,
}: CapabilitySwitchProps) {
  return (
    <button
      className={`capability-switch${checked ? ' is-on' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    >
      <span />
    </button>
  )
}

export default CapabilitySwitch
