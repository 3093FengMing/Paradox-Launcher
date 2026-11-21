#![cfg(target_os = "linux")]

use glib::{Variant, prelude::ToVariant};

fn strings() -> Variant {
    ["first", "世界", "last"].as_slice().to_variant()
}

#[test]
fn next_preserves_borrowed_strings_and_exhaustion() {
    let value = strings();
    let mut iter = value.array_iter_str().unwrap();

    assert_eq!(iter.len(), 3);
    assert_eq!(iter.next(), Some("first"));
    assert_eq!(iter.next(), Some("世界"));
    assert_eq!(iter.next(), Some("last"));
    assert_eq!(iter.len(), 0);
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(iter.next(), None);
}

#[test]
fn nth_handles_skips_and_overflow_without_reusing_an_item() {
    let value = strings();
    let mut iter = value.array_iter_str().unwrap();

    assert_eq!(iter.nth(1), Some("世界"));
    assert_eq!(iter.len(), 1);
    assert_eq!(iter.next(), Some("last"));
    assert_eq!(iter.next(), None);

    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.nth(usize::MAX), None);
    assert_eq!(iter.len(), 0);
    assert_eq!(iter.next_back(), None);
}

#[test]
fn last_returns_the_remaining_tail_and_handles_empty_arrays() {
    let value = strings();
    let mut iter = value.array_iter_str().unwrap();

    assert_eq!(iter.next(), Some("first"));
    assert_eq!(iter.last(), Some("last"));

    let empty = Vec::<String>::new().to_variant();
    let mut iter = empty.array_iter_str().unwrap();
    assert_eq!(iter.len(), 0);
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(iter.next(), None);
    assert_eq!(iter.nth_back(0), None);
    assert_eq!(iter.last(), None);
}

#[test]
fn next_back_interleaves_with_next_without_duplicate_items() {
    let value = strings();
    let mut iter = value.array_iter_str().unwrap();

    assert_eq!(iter.next_back(), Some("last"));
    assert_eq!(iter.next(), Some("first"));
    assert_eq!(iter.next_back(), Some("世界"));
    assert_eq!(iter.len(), 0);
    assert_eq!(iter.next_back(), None);
    assert_eq!(iter.next(), None);
}

#[test]
fn nth_back_handles_skips_and_overflow_without_reusing_an_item() {
    let value = strings();
    let mut iter = value.array_iter_str().unwrap();

    assert_eq!(iter.nth_back(1), Some("世界"));
    assert_eq!(iter.len(), 1);
    assert_eq!(iter.nth_back(0), Some("first"));
    assert_eq!(iter.nth_back(0), None);

    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.nth_back(usize::MAX), None);
    assert_eq!(iter.len(), 0);
    assert_eq!(iter.next(), None);
}
