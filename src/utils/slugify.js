const slugify = (text) => {
  const trMap = {
    'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g',
    'ı': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o',
    'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u',
  };
  return text
    .split('')
    .map(char => trMap[char] || char)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
};

module.exports = slugify;
