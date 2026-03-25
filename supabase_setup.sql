-- 1. Create a table for song metadata
create table if not exists public.songs (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  url text not null,
  position int default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Enable Row Level Security (RLS)
alter table public.songs enable row level security;

-- 3. Create a policy to allow everyone to see and add songs (Public for now)
create policy "Public Access" on public.songs for all using (true);

-- 4. STORAGE POLICIES (Run this to allow UPLOADS)
-- This allows anyone to upload to the 'songs' bucket
create policy "Allow Public Uploads"
on storage.objects for insert
with check ( bucket_id = 'songs' );

-- This allows anyone to read/download from the 'songs' bucket
create policy "Allow Public Select"
on storage.objects for select
using ( bucket_id = 'songs' );

-- INSTRUCTIONS:
-- 1. Go to Supabase Dashboard -> Storage
-- 2. Make sure you created a bucket named "songs"
-- 3. Make sure the bucket itself is set to "Public"
