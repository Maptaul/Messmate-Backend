-- A bill whose balance opened the next closed month: it no longer asks for payment.
ALTER TYPE "BillStatus" ADD VALUE 'CARRIED';
