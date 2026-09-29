use std::{collections::HashMap, sync::Arc};

use parking_lot::Mutex;

type Slot<V> = Arc<Mutex<Option<Arc<V>>>>;

pub struct Pool<V> {
    slots: Mutex<HashMap<String, Slot<V>>>,
}

impl<V> Default for Pool<V> {
    fn default() -> Self {
        Self { slots: Mutex::default() }
    }
}

pub fn server_key(cwd: &str, id: &str) -> String {
    let cwd = match crate::wsl::parse_host_path(cwd) {
        Some((distro, linux)) => crate::wsl::host_path(&distro, &linux),
        None => cwd.to_string(),
    };
    format!("{}|{id}", cwd.replace('/', "\\").trim_end_matches('\\').to_lowercase())
}

impl<V> Pool<V> {
    pub fn get(
        &self,
        key: &str,
        alive: impl Fn(&V) -> bool,
        create: impl FnOnce() -> anyhow::Result<V>,
    ) -> anyhow::Result<Arc<V>> {
        let slot = self.slots.lock().entry(key.to_string()).or_default().clone();
        let mut current = slot.lock();
        if let Some(value) = current.as_ref().filter(|v| alive(v)) {
            return Ok(value.clone());
        }
        let stale = current.take();
        drop(stale);
        let value = Arc::new(create()?);
        *current = Some(value.clone());
        Ok(value)
    }

    pub fn peek(&self, key: &str) -> Option<Arc<V>> {
        let slot = self.slots.lock().get(key).cloned()?;
        let current = slot.try_lock()?;
        current.clone()
    }

    pub fn remove_if(&self, key: &str, matches: impl Fn(&Arc<V>) -> bool) -> Option<Arc<V>> {
        let slot = self.slots.lock().get(key).cloned()?;
        let mut current = slot.lock();
        if !current.as_ref().is_some_and(&matches) {
            return None;
        }
        current.take()
    }

    pub fn remove(&self, key: &str) -> Option<Arc<V>> {
        self.remove_if(key, |_| true)
    }

    pub fn evict(&self, stale: impl Fn(&V) -> bool) -> Vec<Arc<V>> {
        let slots: Vec<(String, Slot<V>)> = self.slots.lock().iter().map(|(k, s)| (k.clone(), s.clone())).collect();
        let mut removed = Vec::new();
        for (key, slot) in slots {
            let Some(mut current) = slot.try_lock() else { continue };
            if current.as_ref().is_some_and(|v| stale(v)) {
                removed.extend(current.take());
            }
            if current.is_none() {
                let mut map = self.slots.lock();
                if map.get(&key).is_some_and(|s| Arc::ptr_eq(s, &slot)) {
                    map.remove(&key);
                }
            }
        }
        removed
    }

    pub fn drain(&self) -> Vec<Arc<V>> {
        let slots: Vec<Slot<V>> = self.slots.lock().drain().map(|(_, slot)| slot).collect();
        slots.into_iter().filter_map(|slot| slot.lock().take()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn creates_once_per_key_even_when_racing() {
        let pool: Arc<Pool<usize>> = Arc::default();
        let created = Arc::new(AtomicUsize::new(0));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let (pool, created) = (pool.clone(), created.clone());
                std::thread::spawn(move || {
                    *pool
                        .get("k", |_| true, || {
                            std::thread::sleep(std::time::Duration::from_millis(50));
                            Ok(created.fetch_add(1, Ordering::SeqCst))
                        })
                        .unwrap()
                })
            })
            .collect();
        let values: Vec<usize> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(created.load(Ordering::SeqCst), 1);
        assert!(values.iter().all(|v| *v == 0));
    }

    #[test]
    fn replaces_dead_values_and_removes_only_matching() {
        let pool: Pool<u32> = Pool::default();
        let first = pool.get("k", |_| true, || Ok(1)).unwrap();
        assert_eq!(*pool.get("k", |v| *v != 1, || Ok(2)).unwrap(), 2);
        assert!(pool.remove_if("k", |v| Arc::ptr_eq(v, &first)).is_none());
        assert_eq!(pool.remove("k").map(|v| *v), Some(2));
        assert!(pool.peek("k").is_none());
    }

    #[test]
    fn evicts_only_stale_values() {
        let pool: Pool<u32> = Pool::default();
        pool.get("old", |_| true, || Ok(1)).unwrap();
        pool.get("new", |_| true, || Ok(2)).unwrap();
        let evicted: Vec<u32> = pool.evict(|v| *v == 1).into_iter().map(|v| *v).collect();
        assert_eq!(evicted, [1]);
        assert!(pool.peek("old").is_none());
        assert_eq!(pool.peek("new").map(|v| *v), Some(2));
    }

    #[test]
    fn normalizes_server_keys() {
        assert_eq!(server_key(r"\\wsl$\Debian\home\me\", "user:pg"), server_key(r"\\wsl.localhost\Debian\home\me", "user:pg"));
        assert_eq!(server_key(r"C:\Work\App\", "x"), server_key("c:/work/app", "x"));
    }
}
