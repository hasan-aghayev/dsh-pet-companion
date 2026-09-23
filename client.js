window.__ModuleLoader__.load({
  id: 'dsh-pet-companion',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PATH = '/api/pet-companion/visibility'
    const NS = 'petCompanion'
    const dictionaries = {
      en: { showPet: 'Show pet', unavailable: 'Pet visibility is unavailable.' },
      zh: { showPet: '\u663e\u793a\u5ba0\u7269', unavailable: '\u5ba0\u7269\u663e\u793a\u72b6\u6001\u4e0d\u53ef\u7528' },
    }

    function VisibilityIcon({ visible }) {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: visible
        ? 'M2.8 12s3.25-6.1 9.2-6.1 9.2 6.1 9.2 6.1-3.25 6.1-9.2 6.1S2.8 12 2.8 12Z'
        : 'M3 3l18 18M10.6 6.1A10.4 10.4 0 0 1 12 6c5.95 0 9.2 6 9.2 6a16.6 16.6 0 0 1-3.05 3.55M6.2 6.2C4 7.7 2.8 12 2.8 12s3.25 6.1 9.2 6.1a9.7 9.7 0 0 0 3-.46' }),
      visible ? h('circle', { cx: 12, cy: 12, r: 2.5 }) : null)
    }

    function VisibilityControl({ wide, t }) {
      const [visible, setVisible] = React.useState(true)
      const [busy, setBusy] = React.useState(true)
      const [hovered, setHovered] = React.useState(false)
      const [focused, setFocused] = React.useState(false)
      const [error, setError] = React.useState('')
      const busyRef = React.useRef(false)
      const loadedRef = React.useRef(false)
      const translate = (key) => typeof t === 'function' ? t(key) : (key === 'showPet' ? 'Show pet' : 'Pet visibility is unavailable.')
      const label = translate('showPet')

      React.useEffect(() => {
        let disposed = false
        const refresh = async () => {
          if (busyRef.current) return
          try {
            const response = await fetch(PATH, { method: 'GET', cache: 'no-store', credentials: 'same-origin' })
            if (!response.ok) throw new Error(translate('unavailable'))
            const value = await response.json()
            if (!disposed && typeof value.visible === 'boolean') {
              setVisible(value.visible)
              setError('')
            }
          } catch (cause) {
            if (!disposed) setError(translate('unavailable'))
          } finally {
            if (!disposed && !loadedRef.current) {
              loadedRef.current = true
              setBusy(false)
            }
          }
        }
        void refresh()
        const timer = window.setInterval(() => { void refresh() }, 2500)
        return () => {
          disposed = true
          window.clearInterval(timer)
        }
      }, [])

      const toggle = async () => {
        if (busyRef.current) return
        const next = !visible
        busyRef.current = true
        setBusy(true)
        setError('')
        try {
          const response = await fetch(PATH, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible: next }),
          })
          if (!response.ok) throw new Error(translate('unavailable'))
          const value = await response.json()
          if (typeof value.visible !== 'boolean') throw new Error(translate('unavailable'))
          setVisible(value.visible)
        } catch (cause) {
          setError(translate('unavailable'))
        } finally {
          busyRef.current = false
          setBusy(false)
        }
      }

      const style = wide
        ? {
            display: 'flex', alignItems: 'center', gap: 8,
            width: 'calc(100% + 4px)', height: 42, margin: '4px -2px',
            padding: '0 10px 0 8px', boxSizing: 'border-box',
            border: 0, borderRadius: 12,
            background: hovered ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            fontFamily: 'inherit', fontSize: 14, lineHeight: '22px',
            textAlign: 'left', cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.68 : 1,
            outline: focused ? '2px solid var(--dsw-alias-brand-primary)' : 'none',
            outlineOffset: 2,
          }
        : {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flex: 'none', width: 36, height: 36, margin: 0, padding: 0,
            boxSizing: 'border-box', border: 0, borderRadius: 12,
            background: hovered ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.68 : 1,
            outline: focused ? '2px solid var(--dsw-alias-brand-primary)' : 'none',
            outlineOffset: 2,
          }
      const children = [h(VisibilityIcon, { key: 'icon', visible })]
      if (wide) {
        children.push(h('span', {
          key: 'label',
          style: { flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
        }, label))
        children.push(h('span', {
          key: 'track',
          'aria-hidden': true,
          style: {
            position: 'relative', flex: 'none', width: 36, height: 20,
            padding: 2, boxSizing: 'border-box', borderRadius: 10,
            background: visible ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l3)',
            transition: 'background 120ms ease',
          },
        }, h('span', {
          style: {
            display: 'block', width: 16, height: 16, borderRadius: '50%',
            background: 'var(--dsw-alias-label-primary-foreground)',
            transform: visible ? 'translateX(16px)' : 'translateX(0)',
            transition: 'transform 120ms ease',
          },
        })))
      }

      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': visible,
        'aria-label': label,
        'aria-busy': busy,
        title: error || label,
        disabled: busy,
        onClick: toggle,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        style,
      }, children)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'pet-companion: sidebar locale')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'pet-companion-visibility',
          order: 10000,
          locale: NS,
          label: () => t('showPet'),
        }, VisibilityControl))
      },
    }
  },
})
