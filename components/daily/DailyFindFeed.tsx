'use client';

/*
================================================================================
DAILY FIND FEED
================================================================================
Other players' finds for a challenge — shown ONLY after the viewer submits their
own (the get_daily_finds RPC returns NOT_SUBMITTED otherwise). Each find renders
its captured Street View still and can be downvoted; a find that crosses the
>=90% downvote threshold is removed server-side and disappears on refetch.
================================================================================
*/

import { useCallback, useEffect, useState } from 'react';

import { GoogleMap, InfoWindowF, MarkerF } from '@react-google-maps/api';
import toast from 'react-hot-toast';
import { FaThumbsDown } from 'react-icons/fa';

import { getStreetViewImageUrl } from '@/components/streetview/streetViewHelpers';
import { mapOptions } from '@/components/utils/mapUtils';
import type { DailyFind, DailyViewpoint } from '@/components/utils/types';
import { downvoteDailyFind, formatDuration, getDailyFinds } from '@/lib/daily';
import { useT } from '@/lib/i18n/I18nProvider';

export default function DailyFindFeed({ date, answer = null, isLoaded = false }: { date: string; answer?: DailyViewpoint | null; isLoaded?: boolean }) {
    const { t } = useT();
    const [finds, setFinds] = useState<DailyFind[] | null>(null);

    useEffect(() => {
        let alive = true;
        getDailyFinds(date)
            .then((res) => alive && setFinds(res.success ? res.finds : []))
            .catch(() => alive && setFinds([]));
        return () => {
            alive = false;
        };
    }, [date]);

    const onDownvote = async (find: DailyFind) => {
        // optimistic toggle
        setFinds((prev) => prev?.map((f) => (f.id === find.id ? { ...f, my_downvote: !f.my_downvote, downvotes: f.downvotes + (f.my_downvote ? -1 : 1) } : f)) ?? prev);
        try {
            const res = await downvoteDailyFind(find.id);
            if (res.removed) {
                setFinds((prev) => prev?.filter((f) => f.id !== find.id) ?? prev);
                toast.success(t('daily.findRemoved'));
                return;
            }
            setFinds((prev) => prev?.map((f) => (f.id === find.id ? { ...f, my_downvote: res.my_downvote, downvotes: res.downvotes } : f)) ?? prev);
        } catch {
            // revert on failure
            setFinds((prev) => prev?.map((f) => (f.id === find.id ? { ...f, my_downvote: find.my_downvote, downvotes: find.downvotes } : f)) ?? prev);
            toast.error(t('daily.voteError'));
        }
    };

    if (finds === null) return <p className="text-slate-400 text-sm">{t('common.loading')}</p>;

    const hasFinds = finds.length > 0;

    return (
        <div>
            {(hasFinds || answer) && <DailyFindsMap finds={finds} answer={answer} isLoaded={isLoaded} />}
            {hasFinds ? (
                <>
                    <p className="mb-3 text-xs text-slate-400">{t('daily.reportHint')}</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {finds.map((f) => (
                            <div key={f.id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
                                <img src={getStreetViewImageUrl(f, 300)} alt={f.name} className="aspect-square w-full object-cover" loading="lazy" />
                                <div className="flex items-center justify-between gap-2 p-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-xs font-medium text-white">{f.name}</p>
                                        <p className="font-mono text-[11px] text-indigo-300">{formatDuration(f.duration_ms)}</p>
                                    </div>
                                    <button type="button" onClick={() => onDownvote(f)} title={t('daily.downvote')} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold transition-colors ${f.my_downvote ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                                        <FaThumbsDown size={11} /> {f.downvotes}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <p className="text-slate-400 text-sm">{t('daily.noFinds')}</p>
            )}
        </div>
    );
}

// A heatmap of where everyone found the category — plus the example/answer
// viewpoint as a gold star — each with a hover preview.
function DailyFindsMap({ finds, answer, isLoaded }: { finds: DailyFind[]; answer?: DailyViewpoint | null; isLoaded: boolean }) {
    const { t } = useT();
    const [hovered, setHovered] = useState<DailyFind | null>(null);
    const [answerHover, setAnswerHover] = useState(false);

    const points = finds.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng));

    const onLoad = useCallback(
        (map: google.maps.Map) => {
            const bounds = new google.maps.LatLngBounds();
            points.forEach((f) => bounds.extend({ lat: f.lat, lng: f.lng }));
            if (answer) bounds.extend({ lat: answer.lat, lng: answer.lng });
            if (bounds.isEmpty()) return;
            map.fitBounds(bounds, 48);
        },
        // points is derived from finds each render; onLoad only fires once, so this is fine.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [finds, answer],
    );

    if (!isLoaded || (points.length === 0 && !answer)) return null;

    // Heatmap-style glow: a soft radial-gradient blob per find (the native
    // HeatmapLayer was removed from the Maps JS API in v3.65). Overlapping blobs
    // accumulate, so clusters read "hotter" — the same effect, with stable API.
    const glowIcon: google.maps.Icon = {
        url: `data:image/svg+xml;utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="rgba(244,63,94,0.55)"/><stop offset="55%" stop-color="rgba(244,63,94,0.22)"/><stop offset="100%" stop-color="rgba(244,63,94,0)"/></radialGradient></defs><circle cx="36" cy="36" r="36" fill="url(#g)"/></svg>')}`,
        scaledSize: new google.maps.Size(72, 72),
        anchor: new google.maps.Point(36, 36),
    };

    // Gold star marking the example/answer viewpoint, distinct from the red finds.
    const starIcon: google.maps.Symbol = {
        path: 'M 0,-11 L 3.2,-3.4 L 11,-3.4 L 4.5,1.7 L 7,9.5 L 0,4.8 L -7,9.5 L -4.5,1.7 L -11,-3.4 L -3.2,-3.4 Z',
        fillColor: '#fbbf24',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 1.5,
        scale: 1.1,
    };

    return (
        <div className="relative mb-4 h-56 overflow-hidden rounded-xl">
            <GoogleMap mapContainerClassName="absolute inset-0" options={mapOptions({ streetViewControl: false })} onLoad={onLoad}>
                {points.map((f) => (
                    <MarkerF key={`glow-${f.id}`} position={{ lat: f.lat, lng: f.lng }} options={{ icon: glowIcon, clickable: false, zIndex: 1 }} />
                ))}
                {points.map((f) => (
                    <MarkerF key={f.id} position={{ lat: f.lat, lng: f.lng }} zIndex={2} onMouseOver={() => setHovered(f)} onMouseOut={() => setHovered((h) => (h?.id === f.id ? null : h))} options={{ icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#f43f5e', fillOpacity: 0.9, strokeColor: '#ffffff', strokeWeight: 1 } }} />
                ))}
                {answer && <MarkerF position={{ lat: answer.lat, lng: answer.lng }} zIndex={3} onMouseOver={() => setAnswerHover(true)} onMouseOut={() => setAnswerHover(false)} options={{ icon: starIcon, title: t('daily.answerLocation') }} />}
                {hovered && (
                    <InfoWindowF position={{ lat: hovered.lat, lng: hovered.lng }} options={{ disableAutoPan: true, pixelOffset: new google.maps.Size(0, -8) }}>
                        <div className="w-36">
                            <img src={getStreetViewImageUrl(hovered, 200)} alt={hovered.name} className="mb-1 aspect-square w-full rounded object-cover" />
                            <p className="truncate text-xs font-bold text-slate-900">{hovered.name}</p>
                            <p className="font-mono text-[11px] text-indigo-700">{formatDuration(hovered.duration_ms)}</p>
                        </div>
                    </InfoWindowF>
                )}
                {answer && answerHover && (
                    <InfoWindowF position={{ lat: answer.lat, lng: answer.lng }} options={{ disableAutoPan: true, pixelOffset: new google.maps.Size(0, -10) }}>
                        <div className="w-36">
                            <img src={getStreetViewImageUrl(answer, 200)} alt="" className="mb-1 aspect-square w-full rounded object-cover" />
                            <p className="text-xs font-bold text-amber-600">{t('daily.answerLocation')}</p>
                        </div>
                    </InfoWindowF>
                )}
            </GoogleMap>
            <span className="absolute bottom-2 left-2 z-10 rounded-md bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-slate-300 shadow">{t('daily.findsHeatmap')}</span>
        </div>
    );
}
