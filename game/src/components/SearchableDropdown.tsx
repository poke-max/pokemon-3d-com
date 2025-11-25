import { useEffect, useMemo, useRef, useState } from 'react';
import type { DropdownOption } from '../types/battle';

interface SearchableDropdownProps {
	label: string;
	value: string;
	options: DropdownOption[];
	placeholder?: string;
	disabled?: boolean;
	onChange: (value: string) => void;
	allowClear?: boolean;
}

export function SearchableDropdown({
	label,
	value,
	options,
	placeholder,
	disabled,
	onChange,
	allowClear = true,
}: SearchableDropdownProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState(value);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setQuery(value);
	}, [value]);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	const normalized = query.trim().toLowerCase();
	const filteredOptions = useMemo(() => {
		const source = normalized
			? options.filter(option => option.label.toLowerCase().includes(normalized))
			: options;
		return source.slice(0, 40);
	}, [options, normalized]);

	const commitValue = (newValue: string) => {
		onChange(newValue);
		setQuery(newValue);
		setOpen(false);
	};

	return (
		<div className={`dropdown ${disabled ? 'disabled' : ''}`} ref={containerRef}>
			<span className="dropdown-label">{label}</span>
			<div className="dropdown-input-wrapper">
				<input
					value={query}
					placeholder={placeholder}
					disabled={disabled}
					onFocus={event => {
						if (!disabled) {
							setOpen(true);
							event.currentTarget.select();
						}
					}}
					onChange={event => {
						setQuery(event.target.value);
						if (!disabled) setOpen(true);
					}}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							event.preventDefault();
							commitValue(query);
						} else if (event.key === 'Escape') {
							setOpen(false);
							event.currentTarget.blur();
						}
					}}
					onBlur={() => {
						if (!disabled) commitValue(query);
					}}
				/>
				{allowClear && query && !disabled ? (
					<button
						type="button"
						className="dropdown-clear"
						onMouseDown={event => event.preventDefault()}
						onClick={() => {
							setQuery('');
							onChange('');
						}}
						aria-label="Limpiar"
					>
						×
					</button>
				) : null}
			</div>
			{open && !disabled && (
				<ul className="dropdown-list">
					{filteredOptions.length ? (
						filteredOptions.map(option => (
							<li
								key={option.value}
								onMouseDown={event => {
									event.preventDefault();
									commitValue(option.value);
								}}
							>
								{option.label}
							</li>
						))
					) : (
						<li className="dropdown-empty">Sin resultados</li>
					)}
				</ul>
			)}
		</div>
	);
}
