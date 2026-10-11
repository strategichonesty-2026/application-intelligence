import { useId } from 'react';
import Icon from './Icon';

// Small, reusable building blocks. None of these know anything about monitoring.

export function Button({ variant = 'secondary', size = 'md', icon, loading = false, children, className = '', ...rest }) {
  return (
    <button type="button" className={`ai-btn ai-btn--${variant} ai-btn--${size} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Icon name="loader" spin /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ variant = 'secondary', size = 'md', icon, external = false, children, className = '', ...rest }) {
  return (
    <a className={`ai-btn ai-btn--${variant} ai-btn--${size} ${className}`} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
      {external ? <Icon name="external-link" size={14} /> : null}
    </a>
  );
}

export function IconButton({ icon, label, ...rest }) {
  return (
    <button type="button" className="ai-iconbtn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={18} />
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className = '', flush = false, as: Tag = 'section' }) {
  const id = useId();
  return (
    <Tag className={`ai-card ${className}`} aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <header className="ai-card__head">
          <div>
            {title && <h2 id={id} className="ai-card__title">{title}</h2>}
            {subtitle && <p className="ai-card__sub">{subtitle}</p>}
          </div>
          {actions && <div className="ai-card__actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'ai-card__body'}>{children}</div>
    </Tag>
  );
}

export function Field({ label, hint, error, children }) {
  const id = useId();
  const child = children({ id, 'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined, 'aria-invalid': error ? true : undefined });
  return (
    <div className="ai-field">
      <label className="ai-field__label" htmlFor={id}>{label}</label>
      {child}
      {hint && !error && <p id={`${id}-hint`} className="ai-field__hint">{hint}</p>}
      {error && <p id={`${id}-err`} className="ai-field__error" role="alert">{error}</p>}
    </div>
  );
}

export function Select({ label, value, onChange, options, ...rest }) {
  return (
    <label className="ai-select">
      <span className="ai-select__label">{label}</span>
      <span className="ai-select__wrap">
        <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Icon name="chevron-down" size={14} className="ai-select__chev" />
      </span>
    </label>
  );
}

export function SearchBox({ value, onChange, label = 'Search', placeholder }) {
  return (
    <label className="ai-search">
      <span className="ai-visually-hidden">{label}</span>
      <Icon name="search" size={16} className="ai-search__icon" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

// Hover / keyboard-focus explanation. The trigger stays focusable so keyboard
// and screen-reader users get the same text.
export function Tip({ text, children }) {
  const id = useId();
  return (
    <span className="ai-tip" tabIndex={0} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className="ai-tip__bubble">{text}</span>
    </span>
  );
}

export function Skeleton({ width = '100%', height = 14, className = '' }) {
  return <span className={`ai-skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}
