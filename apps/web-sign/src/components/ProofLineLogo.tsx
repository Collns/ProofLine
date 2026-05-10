interface Props {
  size?: 'sm' | 'md';
}

export function ProofLineLogo({ size = 'md' }: Props) {
  const dim = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  const text = size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <div className="flex items-center gap-2 text-[#0B1F3A]">
      <span aria-hidden="true" className={`inline-block ${dim} rounded-md bg-[#0B1F3A]`} />
      <span className={`${text} font-semibold tracking-tight`}>ProofLine</span>
    </div>
  );
}
