import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateStore } from '../src/content/candidate-store';
import { scan } from '../src/content/element-scanner';
import { execute } from '../src/content/action-executor';
import { layout } from './helpers';

let store: CandidateStore;
beforeEach(() => {
  layout();
  vi.stubGlobal('location', new URL('https://www.youtube.com/results?search_query=cat+videos'));
  document.body.innerHTML = readFileSync('tests/fixtures/youtube.html', 'utf8');
  store = new CandidateStore();
});
afterEach(() => { store.clear(); document.body.style.cssText = ''; document.documentElement.style.cssText = ''; vi.unstubAllGlobals(); });
const videoLinks = () => scan(store, 200).filter(candidate => candidate.role === 'link' && candidate.scope === 'main_content');

describe('regular YouTube results', () => {
  it('uses the viewport for body overflow propagated to the root', () => {
    document.body.style.overflowY = 'scroll';
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 0));
    expect(videoLinks().map(candidate => candidate.name)).toEqual(['Goofy Cats', 'Sleepy Cats']);
    document.body.style.overflowY = '';
  });
  it('retains clipping by the body when root overflow prevents propagation', () => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflowY = 'scroll';
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 0));
    expect(videoLinks()).toEqual([]);
  });
  it('finds video links after a large non-interactive prefix', () => {
    const prefix = document.createElement('div');
    prefix.hidden = true;
    prefix.innerHTML = '<span></span>'.repeat(20_100);
    document.body.prepend(prefix);
    expect(videoLinks().map(candidate => candidate.name)).toEqual(['Goofy Cats', 'Sleepy Cats']);
  });
  it('keeps interleaved shadow links in page order', () => {
    document.body.innerHTML = '<h3><a href="https://www.youtube.com/watch?v=first">First</a></h3><ytd-video-renderer></ytd-video-renderer><h3><a href="https://www.youtube.com/watch?v=third">Third</a></h3>';
    document.querySelector('ytd-video-renderer')!.attachShadow({ mode: 'open' }).innerHTML = '<h3><a href="https://www.youtube.com/watch?v=second">Second</a></h3>';
    expect(videoLinks().map(candidate => candidate.name)).toEqual(['First', 'Second', 'Third']);
  });
  it('deduplicates class-based lockups and extracts their visible heading title', () => {
    document.body.innerHTML = '<div class="yt-lockup-view-model-wiz"><a href="https://www.youtube.com/watch?v=modern123" aria-label="Modern Cats by Example Channel"><span>5:00</span></a><div class="yt-lockup-metadata-view-model-wiz__title" role="heading"><a href="https://www.youtube.com/watch?v=modern123" aria-label="Modern Cats by Example Channel">Modern Cats</a></div></div>';
    expect(videoLinks().map(candidate => candidate.name)).toEqual(['Modern Cats']);
  });
  it('labels an empty thumbnail from a visible card title when only the thumbnail is clickable', () => {
    document.body.innerHTML = '<ytd-rich-grid-media><a href="https://www.youtube.com/watch?v=image123"><img src="thumbnail.jpg"></a><h3>Image Cats</h3></ytd-rich-grid-media>';
    expect(videoLinks().map(candidate => candidate.name)).toEqual(['Image Cats']);
  });
  it('keeps channel links outside the numbered videos even under a main landmark', () => {
    document.body.innerHTML = '<main>' + document.body.innerHTML + '</main>';
    expect(videoLinks().map(candidate => candidate.name)).toEqual(['Goofy Cats', 'Sleepy Cats']);
  });
  it('retains video classification when the title contains a transaction word', () => {
    document.querySelector('#first-video #video-title')!.textContent = 'How to remove cat hair';
    expect(videoLinks()[0].semantic_kind).toBe('search_result');
  });
  it('exposes the requested title in main_content without requiring a native main landmark', () => {
    expect(document.querySelector('main, [role=main]')).toBeNull();
    expect(videoLinks().find(candidate => candidate.name === 'Goofy Cats')).toMatchObject({ semantic_kind: 'search_result' });
  });
  it('keeps one activation target per video instead of competing title and thumbnail links', () => {
    const candidates = scan(store, 200);
    expect(candidates.filter(candidate => candidate.name.includes('Goofy Cats'))).toHaveLength(1);
    expect(candidates.filter(candidate => candidate.name.includes('Sleepy Cats'))).toHaveLength(1);
  });
  it('numbers organic videos without header, advertising, channel or related links', () => {
    expect(videoLinks().map(candidate => [candidate.name, candidate.ordinal])).toEqual([['Goofy Cats', 1], ['Sleepy Cats', 2]]);
  });
  it('dispatches the exact named video link through the existing action safety checks', () => {
    const candidate = videoLinks().find(candidate => candidate.name === 'Goofy Cats');
    expect(candidate).toBeDefined();
    const click = vi.fn(event => event.preventDefault());
    document.querySelector('#first-video #video-title')!.addEventListener('click', click);
    execute(store, store.documentId, { kind: 'click', element_id: candidate!.id, open_in_new_tab: false });
    expect(click).toHaveBeenCalledOnce();
  });
  it('retains a visible thumbnail when its title is not interactable', () => {
    document.querySelector('#first-video #video-title')!.setAttribute('hidden', '');
    expect(videoLinks().some(candidate => candidate.name.startsWith('Goofy Cats'))).toBe(true);
  });
  it('keeps repeated video results distinct across different cards', () => {
    document.querySelector('ytd-item-section-renderer')!.append(document.querySelector('#first-video')!.cloneNode(true));
    expect(videoLinks().filter(candidate => candidate.name === 'Goofy Cats')).toHaveLength(2);
  });
  it('does not collapse links with different playback timestamps', () => {
    document.querySelector<HTMLAnchorElement>('#first-video #thumbnail')!.href += '&t=90';
    expect(videoLinks().filter(candidate => candidate.name.includes('Goofy Cats'))).toHaveLength(2);
  });
  it('supports title anchors in the newer lockup component', () => {
    document.body.innerHTML = '<yt-lockup-view-model><a href="https://www.youtube.com/watch?v=modern123" class="yt-lockup-view-model__content-image" aria-label="Modern Cats"><span>5:00</span></a><div class="yt-lockup-metadata-view-model__title"><a href="https://www.youtube.com/watch?v=modern123" aria-label="Modern Cats by Example Channel">Modern Cats</a></div></yt-lockup-view-model>';
    expect(videoLinks().map(candidate => candidate.name)).toEqual(['Modern Cats']);
  });
  it('preserves title selection within an open shadow-root video card', () => {
    document.body.innerHTML = '<ytd-video-renderer></ytd-video-renderer>';
    document.querySelector('ytd-video-renderer')!.attachShadow({ mode: 'open' }).innerHTML = '<a id="thumbnail" href="https://www.youtube.com/watch?v=shadow123" aria-label="Shadow Cats"><span>5:00</span></a><h3><a id="video-title" href="https://www.youtube.com/watch?v=shadow123">Shadow Cats</a></h3>';
    expect(videoLinks().map(candidate => candidate.name)).toEqual(['Shadow Cats']);
  });
  it('classifies known home-page video cards as main content without labelling them search results', () => {
    vi.stubGlobal('location', new URL('https://www.youtube.com/'));
    document.body.innerHTML = '<ytd-rich-grid-media><h3><a id="video-title-link" href="https://www.youtube.com/watch?v=home123">Home Cats</a></h3></ytd-rich-grid-media>';
    expect(videoLinks()[0]).toMatchObject({ name: 'Home Cats', semantic_kind: 'video' });
  });
  it('resolves a nested visible title to its actionable video anchor', () => {
    vi.stubGlobal('location', new URL('https://www.youtube.com/'));
    document.body.innerHTML = '<ytd-rich-grid-media><a id="video-title-link" href="https://www.youtube.com/watch?v=nested123"><yt-formatted-string><span>Nested Cats</span></yt-formatted-string></a></ytd-rich-grid-media>';
    const [candidate] = videoLinks();
    const clicked = vi.fn(event => event.preventDefault());
    document.querySelector('a')!.addEventListener('click', clicked);
    expect(candidate.name).toBe('Nested Cats');
    expect(execute(store, store.documentId, { kind: 'click', element_id: candidate.id, open_in_new_tab: false }).message).toBe('Activation attempted successfully.');
    expect(clicked).toHaveBeenCalledOnce();
  });
  it('keeps an accessible-role fallback if result container markup changes', () => {
    document.body.innerHTML = '<div class="new-layout"><h3><a href="https://www.youtube.com/watch?v=new123">New Layout Cats</a></h3></div>';
    expect(videoLinks()[0]).toMatchObject({ name: 'New Layout Cats', semantic_kind: 'search_result' });
  });
  it('does not classify external or lookalike hosts as YouTube videos', () => {
    document.querySelector<HTMLAnchorElement>('#first-video #video-title')!.href = 'https://www.youtube.com.evil.test/watch?v=goofy123';
    expect(videoLinks().some(candidate => candidate.name === 'Goofy Cats')).toBe(false);
    vi.stubGlobal('location', new URL('https://www.youtube.com.evil.test/results'));
    expect(videoLinks()).toEqual([]);
  });
  it('excludes hidden and disabled video title links', () => {
    document.querySelector('#first-video')!.setAttribute('hidden', '');
    document.querySelector('#second-video')!.setAttribute('aria-disabled', 'true');
    expect(videoLinks()).toEqual([]);
  });
});
