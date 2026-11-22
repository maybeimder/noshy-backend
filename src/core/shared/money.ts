export type Money = { amount: number; currency: 'COP' };
export const cop = (amount: number): Money => ({ amount: Math.round(amount), currency: 'COP' });
