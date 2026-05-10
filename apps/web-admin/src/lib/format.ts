const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour:   '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year:         'numeric',
  month:        'short',
  day:          'numeric',
  hour:         '2-digit',
  minute:       '2-digit',
  timeZoneName: 'short',
});

export function formatTime(unixMs: number): string {
  return TIME_FORMATTER.format(new Date(unixMs));
}

export function formatTimestamp(unixMs: number): string {
  return DATETIME_FORMATTER.format(new Date(unixMs));
}

export function truncateHash(hash: string, chars = 10): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}

// US states for the COMPANY_INFO dropdown.
export const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' },        { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },        { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },     { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },    { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },        { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },         { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },       { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },           { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },       { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },          { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },      { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },       { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },       { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },     { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },           { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },         { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },   { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },   { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },          { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },        { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },     { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },      { code: 'WY', name: 'Wyoming' },
];

export const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
export const EIN_REGEX = /^\d{2}-?\d{7}$/;

export function normalizeEin(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 9) return input;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}
