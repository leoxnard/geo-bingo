"use client";

/*
================================================================================
GAME PAGE
================================================================================
Main game interface controller for the Geo Bingo application.
Manages game state transitions between lobby, playing, and voting phases.
Integrates LobbyView, StreetView, VotingView, and PodiumView components.
================================================================================
*/

import { useState, use, useEffect, useRef, useCallback } from "react";

import { useRouter } from "next/navigation";
import toast, { Toaster } from "react-hot-toast";
import { CiCircleAlert, CiCircleCheck } from "react-icons/ci";

import LobbyView from "@/components/lobby/LobbyView";
import PodiumView from "@/components/PodiumView";
import StreetView from "@/components/StreetView";
import { shuffle } from "@/components/utils/Functions";
import { Player } from "@/components/utils/types";
import { VotingView } from "@/components/VotingView";

import { adjectives, animals } from "../../../lib/names";
import { supabase } from "../../../lib/supabase";

type GameStatus = "lobby" | "playing" | "voting" | "finished";

export default function GameRoom({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const gameId = unwrappedParams.id;
  const router = useRouter();

  // Game state
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [status, setStatus] = useState<GameStatus>("lobby");
  const [exclusiveMode, setExclusiveMode] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [suggestedCategories, setSuggestedCategories] = useState<string[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [gameHostId, setGameHostId] = useState<string>("");
  const [timeLimit, setTimeLimit] = useState(300);
  const [categorySource, setCategorySource] = useState<
    "manual" | "nearbyPlaces" | "nearbyStreetView"
  >("manual");
  const [generationRadius, setGenerationRadius] = useState<number>(10); // in 100m
  const [generationNumber, setGenerationNumber] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<"default" | "easy">("default");
  const [categoriesGenerated, setCategoriesGenerated] =
    useState<boolean>(false);

  // Bingo Mode State
  const [gameMode, setGameMode] = useState<"list" | "bingo">("list");
  const [teamMode, setTeamMode] = useState<"ffa" | "teams">("ffa");
  const [gridSize, setGridSize] = useState(3);
  const [endCondition, setEndCondition] = useState<"first_bingo" | "timer">(
    "timer",
  );
  const [startingPoint, setStartingPoint] = useState<string>("open-world");
  const [gameBoundary, setGameBoundary] = useState<string>("[]");

  // Players & Voting
  const [playerId, setPlayerId] = useState<string>("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [onlinePlayers, setOnlinePlayers] = useState<string[]>([]);
  const [readyPlayers, setReadyPlayers] = useState<string[]>([]);
  const [bannedPlayers, setBannedPlayers] = useState<string[]>([]);
  const [gameLoaded, setGameLoaded] = useState(false);

  const [timeLeft, setTimeLeft] = useState<number>(0);

  const timeUpTriggeredRef = useRef(false);

  // more game options
  const [language, setLanguage] = useState<"german" | "english">("german");
  const [hideMapSymbols, setHideMapSymbols] = useState(false);
  const [hideMiniMap, setHideMiniMap] = useState(false);

  const updateGameModeInfo = async (updates: {
    game_mode?: string;
    team_mode?: string;
    time_limit?: number;
    grid_size?: number;
    bingo_board_mode?: "shared" | "individual";
    starting_point?: string;
    gameBoundary?: string;
    end_condition?: "first_bingo" | "timer";
    hide_map_symbols?: boolean;
    hide_minimap?: boolean;
    exclusive_mode?: boolean;
    category_source?: "manual" | "nearbyPlaces" | "nearbyStreetView";
    generation_radius?: number;
    generation_number?: number;
    language?: "english" | "german";
    difficulty?: "default" | "easy";
    categories_generated?: boolean;
  }) => {
    if (!isHost) return;
    if (updates.game_mode) setGameMode(updates.game_mode as "list" | "bingo");
    if (updates.team_mode) setTeamMode(updates.team_mode as "ffa" | "teams");
    if (updates.time_limit) setTimeLimit(updates.time_limit);
    if (updates.grid_size) setGridSize(updates.grid_size);
    if (updates.starting_point) setStartingPoint(updates.starting_point);
    if (updates.gameBoundary) setGameBoundary(updates.gameBoundary);
    if (updates.end_condition)
      setEndCondition(updates.end_condition as "first_bingo" | "timer");
    if (updates.hide_map_symbols !== undefined)
      setHideMapSymbols(updates.hide_map_symbols);
    if (updates.hide_minimap !== undefined)
      setHideMiniMap(updates.hide_minimap);
    if (updates.exclusive_mode !== undefined)
      setExclusiveMode(updates.exclusive_mode);
    if (updates.category_source !== undefined)
      setCategorySource(updates.category_source);
    if (updates.generation_radius !== undefined)
      setGenerationRadius(updates.generation_radius);
    if (updates.generation_number !== undefined)
      setGenerationNumber(updates.generation_number);
    if (updates.language !== undefined) setLanguage(updates.language);
    if (updates.difficulty !== undefined) setDifficulty(updates.difficulty);
    if (updates.categories_generated !== undefined)
      setCategoriesGenerated(updates.categories_generated);
    await supabase.from("games").update(updates).eq("id", gameId);
  };

  useEffect(() => {
    let localId = sessionStorage.getItem("geoBingoSessionUUID");
    if (!localId) {
      localId = crypto.randomUUID();
      sessionStorage.setItem("geoBingoSessionUUID", localId);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayerId(localId);

    const currentPlayerId = localId;

    const initializeRoom = async () => {
      const storedName = localStorage.getItem("geoBingoPlayerName") || "";
      const playerName =
        storedName.trim() && storedName !== "Unknown Player"
          ? storedName
          : `${adjectives[Math.floor(Math.random() * adjectives.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
      if (!storedName.trim() || storedName === "Unknown Player") {
        localStorage.setItem("geoBingoPlayerName", playerName);
      }

      const [gameResponse, playerResponse] = await Promise.all([
        supabase.from("games").select("*").eq("id", gameId).single(),
        supabase
          .from("players")
          .select("id, bingo_board")
          .eq("id", currentPlayerId)
          .single(),
      ]);

      let gameData = gameResponse.data;
      const existingPlayer = playerResponse.data;

      // Kick Check
      if (gameData?.banned_players?.includes(currentPlayerId)) {
        toast("You have been kicked from this lobby.");
        setTimeout(() => router.push("/"), 2000);
        return;
      }

      // Setup or Load the Game Room
      if (!gameData) {
        const newGameData = {
          id: gameId,
          status: "lobby",
          categories: [],
          ready_players: [],
          time_limit: 300,
          host_id: currentPlayerId,
          banned_players: [],
          game_mode: "list",
          team_mode: "ffa",
          grid_size: 3,
          starting_point: "open-world",
          end_condition: "timer",
          hide_map_symbols: false,
          exclusive_mode: false,
          category_source: "manual",
          generation_radius: 10,
          generation_number: 10,
          language: "german",
          categories_generated: false,
        };
        const { error } = await supabase.from("games").insert([newGameData]);
        if (!error) {
          setIsHost(true);
          setGameHostId(currentPlayerId);
          gameData = newGameData;
          localStorage.setItem(`geoBingoHost_${gameId}`, "true");
        } else {
          console.error("CRITICAL: Failed to create game.", error);
        }
      } else {
        setLastUpdated(gameData.updated_at);
        setStatus(gameData.status || "lobby");
        setCategories(gameData.categories || []);
        setSuggestedCategories(gameData.suggested_categories || []);
        setReadyPlayers(gameData.ready_players || []);
        setBannedPlayers(gameData.banned_players || []);
        setTimeLimit(gameData.time_limit || 300);
        setGameHostId(gameData.host_id || "");
        setGameMode(gameData.game_mode || "list");
        setTeamMode(gameData.team_mode || "ffa");
        setGridSize(gameData.grid_size || 3);
        setStartingPoint(gameData.starting_point || "open-world");
        setGameBoundary(gameData.gameBoundary || "[]");
        setEndCondition(gameData.end_condition || "timer");
        setHideMapSymbols(gameData.hide_map_symbols || false);
        setHideMiniMap(gameData.hide_minimap || false);
        setExclusiveMode(gameData.exclusive_mode || false);
        setCategorySource(gameData.category_source || "manual");
        setGenerationRadius(gameData.generation_radius || 10);
        setGenerationNumber(gameData.generation_number || 10);
        setLanguage(gameData.language || "german");
        setCategoriesGenerated(gameData.categories_generated || false);

        const isActuallyHost = gameData.host_id === currentPlayerId;
        setIsHost(isActuallyHost);
        if (isActuallyHost)
          localStorage.setItem(`geoBingoHost_${gameId}`, "true");
        else localStorage.removeItem(`geoBingoHost_${gameId}`);
      }

      // register player
      let bingoBoardToAssign = null;
      if (
        gameData.status === "playing" &&
        gameData.game_mode === "bingo" &&
        gameData.categories
      ) {
        const neededCount =
          (gameData.grid_size || 3) * (gameData.grid_size || 3);

        if (gameData.bingo_board_mode === "shared") {
          const { data: otherPlayers } = await supabase
            .from("players")
            .select("bingo_board")
            .eq("game_id", gameId)
            .not("bingo_board", "is", null)
            .limit(1);

          if (
            otherPlayers &&
            otherPlayers.length > 0 &&
            otherPlayers[0].bingo_board
          ) {
            bingoBoardToAssign = otherPlayers[0].bingo_board;
          } else {
            bingoBoardToAssign = gameData.categories.slice(0, neededCount);
          }
        } else {
          bingoBoardToAssign = shuffle([...gameData.categories]).slice(
            0,
            neededCount,
          );
        }
      }

      if (!existingPlayer) {
        const insertData = {
          id: currentPlayerId,
          game_id: gameId,
          name: playerName,
          ...(bingoBoardToAssign && { bingo_board: bingoBoardToAssign }),
        };
        const { error: playerInsertErr } = await supabase
          .from("players")
          .insert([insertData]);
        if (playerInsertErr)
          console.error("CRITICAL: Failed to insert player.", playerInsertErr);
      } else {
        const shouldAssignBoard =
          (!existingPlayer.bingo_board ||
            existingPlayer.bingo_board.length === 0) &&
          bingoBoardToAssign;
        const updateData = {
          name: playerName,
          game_id: gameId,
          ...(shouldAssignBoard && { bingo_board: bingoBoardToAssign }),
        };
        const { error: playerUpdateErr } = await supabase
          .from("players")
          .update(updateData)
          .eq("id", currentPlayerId);
        if (playerUpdateErr)
          console.error("CRITICAL: Failed to update player.", playerUpdateErr);
      }

      fetchPlayers();
      setGameLoaded(true);
    };

    const fetchPlayers = async () => {
      const { data } = await supabase
        .from("players")
        .select("id, name, bingo_board, team")
        .eq("game_id", gameId);
      if (data) {
        setPlayers(data);
        // If the current player is no longer in the DB, they were kicked.
        if (!data.some((p) => p.id === currentPlayerId)) {
          router.push("/");
        }
      }
    };

    initializeRoom();

    // Realtime Listeners
    const gameChannel = supabase
      .channel(`game-updates-${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          if (payload.new.banned_players?.includes(currentPlayerId)) {
            router.push("/");
            return;
          }

          if (payload.new.host_id !== undefined) {
            const newHostId = payload.new.host_id;
            setGameHostId(newHostId);
            setIsHost(newHostId === currentPlayerId);
            if (newHostId === currentPlayerId) {
              localStorage.setItem(`geoBingoHost_${gameId}`, "true");
            } else {
              localStorage.removeItem(`geoBingoHost_${gameId}`);
            }
          }

          if (payload.new.updated_at !== undefined)
            setLastUpdated(payload.new.updated_at);
          if (payload.new.status !== undefined) setStatus(payload.new.status);
          if (payload.new.categories !== undefined)
            setCategories(payload.new.categories);
          if (payload.new.suggested_categories !== undefined)
            setSuggestedCategories(payload.new.suggested_categories);
          if (payload.new.ready_players !== undefined)
            setReadyPlayers(payload.new.ready_players);
          if (payload.new.banned_players !== undefined)
            setBannedPlayers(payload.new.banned_players);
          if (payload.new.time_limit !== undefined)
            setTimeLimit(payload.new.time_limit);
          if (payload.new.game_mode !== undefined)
            setGameMode(payload.new.game_mode);
          if (payload.new.team_mode !== undefined)
            setTeamMode(payload.new.team_mode);
          if (payload.new.grid_size !== undefined)
            setGridSize(payload.new.grid_size);
          if (payload.new.starting_point !== undefined)
            setStartingPoint(payload.new.starting_point);
          if (payload.new.gameBoundary !== undefined)
            setGameBoundary(payload.new.gameBoundary);
          if (payload.new.end_condition !== undefined)
            setEndCondition(payload.new.end_condition);
          if (payload.new.hide_map_symbols !== undefined)
            setHideMapSymbols(payload.new.hide_map_symbols);
          if (payload.new.hide_minimap !== undefined)
            setHideMiniMap(payload.new.hide_minimap);
          if (payload.new.exclusive_mode !== undefined)
            setExclusiveMode(payload.new.exclusive_mode);
          if (payload.new.category_source !== undefined)
            setCategorySource(payload.new.category_source);
          if (payload.new.generation_radius !== undefined)
            setGenerationRadius(payload.new.generation_radius);
          if (payload.new.generation_number !== undefined)
            setGenerationNumber(payload.new.generation_number);
          if (payload.new.language !== undefined)
            setLanguage(payload.new.language);
          if (payload.new.difficulty !== undefined)
            setDifficulty(payload.new.difficulty);
          if (payload.new.categories_generated !== undefined)
            setCategoriesGenerated(payload.new.categories_generated);
        },
      )
      .subscribe();

    const playerChannel = supabase
      .channel(`player-updates-${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          // Auto-Kick & redirect if we were deleted from the DB
          if (
            payload.eventType === "DELETE" &&
            payload.old.id === currentPlayerId
          ) {
            router.push("/");
          } else {
            fetchPlayers();
          }
        },
      )
      .subscribe();

    // 5. Presence Tracking
    const presenceChannel = supabase.channel(`presence-${gameId}`);

    presenceChannel
      .on("presence", { event: "sync" }, async () => {
        const state = presenceChannel.presenceState();
        const onlineIds: string[] = [];
        for (const id in state) {
          const presences = state[id] as Array<{ player_id?: string }>;
          presences.forEach((presence) => {
            if (presence.player_id) onlineIds.push(presence.player_id);
          });
        }
        const uniqueOnlineIds = Array.from(new Set(onlineIds));
        setOnlinePlayers(uniqueOnlineIds);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ player_id: currentPlayerId });
        }
      });

    return () => {
      supabase.removeChannel(gameChannel);
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(presenceChannel);
    };
  }, [gameId, router]);

  // Status update handler
  const updateStatus = useCallback(
    async (nextStatus: GameStatus) => {
      const { error } = await supabase
        .from("games")
        .update({ status: nextStatus })
        .eq("id", gameId);
      if (error) console.error("Error updating game status:", error);
    },
    [gameId],
  );

  // --- TIMER LOGIC ---
  useEffect(() => {
    if (!gameLoaded) return;

    const timerStorageKey = `geoBingoTimerEnd_${gameId}`;
    const clearTimerState = () => {
      localStorage.removeItem(timerStorageKey);
      timeUpTriggeredRef.current = false;
      setTimeLeft(0);
    };

    // Non-playing phases always clear persisted timer so a new round starts fresh.
    if (status !== "playing") {
      clearTimerState();
      return;
    }

    // Playing phase: restore existing deadline across reloads or create a new one.
    const tick = () => {
      const now = Date.now();
      const rawStored = localStorage.getItem(timerStorageKey);
      const hasValidStored = rawStored !== null && !isNaN(Number(rawStored));

      const endTs = hasValidStored ? Number(rawStored) : now + timeLimit * 1000;

      if (!hasValidStored) {
        localStorage.setItem(timerStorageKey, String(endTs));
      }

      const left = Math.max(0, Math.ceil((endTs - now) / 1000));
      setTimeLeft(left);

      if (left === 0 && isHost && !timeUpTriggeredRef.current) {
        timeUpTriggeredRef.current = true;
        void updateStatus("voting");
      }
    };

    tick();
    const timerId = setInterval(tick, 1000);
    return () => clearInterval(timerId);
  }, [status, timeLimit, isHost, gameId, updateStatus, gameLoaded]);

  const kickPlayer = async (idToKick: string) => {
    if (isHost) {
      setPlayers((prev) => prev.filter((p) => p.id !== idToKick));

      const { data, error } = await supabase
        .from("players")
        .delete()
        .eq("id", idToKick)
        .select();

      if (error || (data && data.length === 0)) {
        console.error(
          "Error deleting player (RLS Policy or Replica Identity):",
          error,
        );
      }

      // Also remove them from ready_players if they were ready
      if (readyPlayers.includes(idToKick)) {
        const updatedReady = readyPlayers.filter((id) => id !== idToKick);
        await supabase
          .from("games")
          .update({ ready_players: updatedReady })
          .eq("id", gameId);
      }
    }
  };

  const makeHost = async (newHostId: string) => {
    if (isHost) {
      await supabase
        .from("games")
        .update({ host_id: newHostId })
        .eq("id", gameId);
      setIsHost(false);
      localStorage.removeItem(`geoBingoHost_${gameId}`);
      toast("You are no longer the host.");
    }
  };

  const banPlayer = async (idToKick: string) => {
    if (isHost) {
      setPlayers((prev) => prev.filter((p) => p.id !== idToKick));

      // Add to banned list in the DB
      const updatedBanned = [...bannedPlayers, idToKick];
      await supabase
        .from("games")
        .update({ banned_players: updatedBanned })
        .eq("id", gameId);

      const { data, error } = await supabase
        .from("players")
        .delete()
        .eq("id", idToKick)
        .select();

      if (error || (data && data.length === 0)) {
        console.error(
          "Error deleting player (RLS Policy or Replica Identity):",
          error,
        );
      }

      // Also remove them from ready_players if they were ready
      if (readyPlayers.includes(idToKick)) {
        const updatedReady = readyPlayers.filter((id) => id !== idToKick);
        await supabase
          .from("games")
          .update({ ready_players: updatedReady })
          .eq("id", gameId);
      }
    }
  };

  const handleFinishGame = async () => {
    await supabase
      .from("games")
      .update({ status: "finished" })
      .eq("id", gameId);
  };

  const selectView = () => {
    // --- VIEW 1: LOBBY ---
    if (status === "lobby") {
      return (
        <LobbyView
          lastUpdated={lastUpdated}
          gameMode={gameMode}
          teamMode={teamMode}
          isHost={isHost}
          gridSize={gridSize}
          startingPoint={startingPoint}
          endCondition={endCondition}
          gameBoundary={gameBoundary}
          updateGameModeInfo={updateGameModeInfo}
          timeLimit={timeLimit}
          exclusiveMode={exclusiveMode}
          categories={categories}
          suggestedCategories={suggestedCategories}
          gameId={gameId}
          players={players}
          onlinePlayers={onlinePlayers}
          playerId={playerId}
          gameHostId={gameHostId}
          makeHost={makeHost}
          kickPlayer={kickPlayer}
          banPlayer={banPlayer}
          router={router}
          supabase={supabase}
          updateStatus={updateStatus}
          setPlayers={setPlayers}
          hideMapSymbols={hideMapSymbols}
          hideMiniMap={hideMiniMap}
          categorySource={categorySource}
          generationRadius={generationRadius}
          generationNumber={generationNumber}
          language={language}
          difficulty={difficulty}
          categoriesGenerated={categoriesGenerated}
        />
      );
    }

    // --- VIEW 2: PLAYING ---
    if (status === "playing") {
      const currentPlayer = players.find((p) => p.id === playerId);
      const myBoard =
        gameMode === "bingo" &&
        currentPlayer?.bingo_board &&
        currentPlayer.bingo_board.length > 0
          ? currentPlayer.bingo_board
          : categories;
      return (
        <StreetView
          myBoard={myBoard}
          gameId={gameId}
          playerId={playerId}
          gameMode={gameMode}
          teamMode={teamMode}
          gridSize={gridSize}
          startingPoint={startingPoint}
          gameBoundary={gameBoundary}
          endCondition={endCondition}
          timeLeft={timeLeft}
          readyPlayers={readyPlayers}
          players={players}
          hideMapSymbols={hideMapSymbols}
          hideMiniMap={hideMiniMap}
          exclusiveMode={exclusiveMode}
        />
      );
    }

    // --- VIEW 3: VOTING ---
    if (status === "voting") {
      return (
        <VotingView
          gameId={gameId}
          isHost={isHost}
          categories={categories}
          playerId={playerId}
          players={players}
          teamMode={teamMode}
          onFinishGame={handleFinishGame}
        />
      );
    }

    // --- VIEW 4: PODIUM (FINISHED) ---
    if (status === "finished") {
      return <PodiumView gameId={gameId} isHost={isHost} teamMode={teamMode} />;
    }
  };

  return (
    <>
      <Toaster
        toastOptions={{
          style: {
            borderRadius: "20px",
            background: "#333",
            color: "#fff",
          },
          success: {
            icon: <CiCircleCheck size="3em" color="#00b01d" />,
            style: {
              color: "#00b01d",
            },
          },
          error: {
            icon: <CiCircleAlert size="3em" color="#ff0000" />,
            style: {
              color: "#ff0000",
            },
            duration: 5000,
          },
        }}
      />
      {selectView()}
    </>
  );
}
