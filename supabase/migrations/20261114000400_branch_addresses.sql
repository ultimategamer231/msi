-- Branch addresses from MSI (Foday, 2026-11-09; QUESTIONS client item 9), in branch order. Only
-- empty addresses are filled, so anything an admin already entered in Settings is kept. Branch
-- names stay as they are until MSI gives them.
update public.branches set address = 'Bypass, Jallah Town, Behind Conex Gas Station'
 where code = 'BR1' and address is null;
update public.branches set address = 'Peace Community, Mamba District #2, Margibi County'
 where code = 'BR2' and address is null;
update public.branches set address = 'Ganta City, Nimba County'
 where code = 'BR3' and address is null;
