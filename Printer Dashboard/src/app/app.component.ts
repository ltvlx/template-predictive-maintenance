import { Component, OnInit, ViewChild } from '@angular/core';
import { ConnectionStatus, QuixService } from './services/quix.service';
import { MediaObserver } from '@angular/flex-layout';
import { FormControl } from '@angular/forms';
import { EventData } from './models/eventData';
import { ActiveStream } from './models/activeStream';
import { ActiveStreamAction } from './models/activeStreamAction';
import { ActiveStreamSubscription } from './models/activeStreamSubscription';
import { ParameterData } from './models/parameterData';
import { Observable, delay, filter, interval, map, merge, pairwise, startWith, tap, timer, withLatestFrom } from 'rxjs';
import { ChartComponent } from './components/chart/chart.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  @ViewChild(ChartComponent) chart: ChartComponent;
  streamsControl = new FormControl<string>('');
  printers: any[] = [];
  workspaceId: string;
  deploymentId: string;
  ungatedToken: string;
  printerStreams: ActiveStream[] = [];
  alertsStreams: ActiveStream[] = [];
  printerStreamsFailureTime: number[] = [];
  printerStreamsEndTime: number[] = [];
  printerData$: Observable<ParameterData>;
  forecastData$: Observable<ParameterData>;
  forecastReset$: Observable<any>;
  forecastDuration$: Observable<number>;
  eventData$: Observable<EventData>;
  streamsMap = new Map<string, string>();
  duration: number = 5 * 60 * 1000;
  forecastLimit: { min: number, max: number } = { min: 40, max: 60 }
  parameterIds: string[] = ['fluctuated_ambient_temperature', 'bed_temperature', 'hotend_temperature'];
  eventIds: string[] = ['over-forecast', 'under-forecast', 'under-now', 'no-alert', 'printer-finished'];
  forecastParameterId = 'forecast_fluctuated_ambient_temperature';
  ranges: { [key: string]: { min: number, max: number } } = {
    [this.parameterIds[0]]: { min: 45, max: 55 },
    [this.parameterIds[1]]: { min: 105, max: 115 },
    [this.parameterIds[2]]: { min: 245, max: 255 }
  };

  constructor(private quixService: QuixService, public media: MediaObserver) { }

  ngOnInit(): void {
    this.ungatedToken = this.quixService.ungatedToken;
    this.quixService.readerConnStatusChanged$.subscribe((status) => {
      if (status !== ConnectionStatus.Connected) return;
      this.quixService.subscribeToActiveStreams(this.quixService.printerDataTopic);
      this.quixService.subscribeToActiveStreams(this.quixService.forecastAlertsTopic);
      this.workspaceId = this.quixService.workspaceId;
    });

    const printerStreams$ = this.quixService.activeStreamsChanged$.pipe(
      filter(({ streams }) => streams?.at(0)?.topicId === `${this.quixService.workspaceId}-${this.quixService.printerDataTopic}`),
      map((streamSubscription: ActiveStreamSubscription) => {
        const { streams } = streamSubscription;
        if (!streams?.length) return [];
        return this.updateActiveSteams(streamSubscription, this.printerStreams)
      })
    );

    printerStreams$.subscribe((activeStreams) => {
      const streamId = this.streamsControl.value;
      if (!streamId || !activeStreams.some((s) => s.streamId === streamId)) {
        const openedStreams = activeStreams
          .filter((f) => f.status === 'Receiving')
          .sort((a, b) => (this.getActiveStreamEndTime(a) || Infinity) < (this.getActiveStreamEndTime(b) || Infinity) ? -1 : 1)
          .sort((a, b) => (this.getActiveStreamFailureTime(a) || Infinity) < (this.getActiveStreamFailureTime(b) || Infinity) ? -1 : 1);
        setTimeout(() => this.streamsControl.setValue(openedStreams.at(0)?.streamId || null), 200);
      }
    });

    const alertStreams$ = this.quixService.activeStreamsChanged$.pipe(
      filter(({ streams }) => streams?.at(0)?.topicId === `${this.quixService.workspaceId}-${this.quixService.forecastAlertsTopic}`),
      map((streamSubscription: ActiveStreamSubscription) => {
        const { streams } = streamSubscription;
        if (!streams?.length) return [];
        return this.updateActiveSteams(streamSubscription, this.alertsStreams)
      })
    );

    alertStreams$.subscribe((activeStreams) => this.alertsStreams = activeStreams);

    interval(1000).pipe(withLatestFrom(printerStreams$)).subscribe(([_, activeStreams]) => {
      this.printerStreams = activeStreams
        .sort((a, b) => (this.getActiveStreamEndTime(a) || Infinity) < (this.getActiveStreamEndTime(b) || Infinity) ? -1 : 1)
        .sort((a, b) => (this.getActiveStreamFailureTime(a) || Infinity) < (this.getActiveStreamFailureTime(b) || Infinity) ? -1 : 1);
      this.printerStreamsFailureTime = activeStreams.map((m) => this.getActiveStreamFailureTime(m)!);
      this.printerStreamsEndTime = activeStreams.map((m) => this.getActiveStreamEndTime(m)!);
    });

    this.printerData$ = this.quixService.paramDataReceived$
      .pipe(filter((f) => f.topicName === this.quixService.printerDataTopic && f.streamId === this.streamsControl.value))
    this.forecastData$ = this.quixService.paramDataReceived$
      .pipe(filter((f) => f.topicName === this.quixService.forecastTopic && f.streamId === this.streamsControl.value + '-down-sampled-forecast'));
    this.eventData$ = this.quixService.eventDataReceived$
      .pipe(filter((f) => f.streamId === this.streamsControl.value + '-alerts'))

    this.forecastReset$ = merge(this.streamsControl.valueChanges, this.forecastData$);

    this.forecastDuration$ = this.forecastData$.pipe(
      map((m) => (m.timestamps[m.timestamps.length - 1] - m.timestamps[0]) / 1000000),
      startWith(8 * 60 * 60 * 1000)
    );

    this.streamsControl.valueChanges.pipe(withLatestFrom(alertStreams$, printerStreams$)).subscribe(([streamId, alertStreams, printerStreams]) => {
      if (!streamId) return;
      const printerDataTopicId = this.quixService.workspaceId + '-' + this.quixService.printerDataTopic;
      const forecastTopicId = this.quixService.workspaceId + '-' + this.quixService.forecastTopic;
      const forecastAlertsTopicId = this.quixService.workspaceId + '-' + this.quixService.forecastAlertsTopic;
      this.subscribeToParameter(printerDataTopicId, streamId, this.parameterIds);
      this.subscribeToParameter(forecastTopicId, streamId + '-down-sampled-forecast', [this.forecastParameterId]);
      this.subscribeToEvent(forecastAlertsTopicId, streamId + '-alerts', this.eventIds);

      // Reset ranges
      const alertStream = alertStreams.find((f) => f.streamId.includes(streamId))!;
      const thresholds: { [key: string]: number[] } = JSON.parse(alertStream.metadata['thresholds'])
      Object.entries(thresholds).forEach(([key, value]) => this.ranges[key] = { min: value[0], max: value[1] })

      // const printerStream = printerStreams.find((f) => f.streamId.includes(streamId))!;

      // let start = JSON.parse(printerStream.metadata['start_time']);
      // console.log('start_time: ', start)
      // console.log('start_time (date): ', new Date(start / 1000000))

      // let end = JSON.parse(printerStream.metadata['end_time']);
      // console.log('end_time: ', end)
      // console.log('end_time (date): ', new Date(end / 1000000))

      // let failures = JSON.parse(printerStream.metadata['failures_replay_speed'])
      // console.log('failures_replay_speed: ', failures)
      // console.log('failures_replay_speed (dates): ', failures.map((m: number) => new Date(m / 1000000)))
    });
  }

  getActiveStreamFailureTime(stream: ActiveStream): number | undefined {
    const now = new Date();
    const failures: number[] = JSON.parse(stream.metadata['failures_replay_speed']);
    const failure = failures.find((timestamp) => timestamp / 1000000 > now.getTime());
    return failure ? failure / 1000000 - now.getTime() : undefined;
  }

  getActiveStreamEndTime(stream: ActiveStream): number | undefined {
    const now = new Date();
    const startTime: number = JSON.parse(stream.metadata['end_time']);
    return startTime ? startTime / 1000000 - now.getTime() : undefined;
  }

  subscribeToParameter(topicId: string, streamId: string, parameterIds: string[]): void {
    const previousStream = this.streamsMap.get(topicId);
    parameterIds.forEach(id => {
      if (previousStream) this.quixService.unsubscribeFromParameter(topicId, previousStream, id);
      this.quixService.subscribeToParameter(topicId, streamId, id)
    });
    this.streamsMap.set(topicId, streamId);
  }

  subscribeToEvent(topicId: string, streamId: string, eventIds: string[]): void {
    const previousStream = this.streamsMap.get(topicId);
    eventIds.forEach(id => {
      if (previousStream) this.quixService.unsubscribeFromEvent(topicId, previousStream, id);
      this.quixService.subscribeToEvent(topicId, streamId, id)
    });
    this.streamsMap.set(topicId, streamId);
  }

  /**
   * Handles when a new stream is added or removed.
   *
   * @param action The action we are performing.
   * @param streams The data within the stream.
   */
  updateActiveSteams(streamSubscription: ActiveStreamSubscription, activeStreams: ActiveStream[]): ActiveStream[] {
    const { streams, action } = streamSubscription;
    const currentStreams = activeStreams.filter((stream) => !streams?.some((s) => s.streamId === stream.streamId));
    switch (action) {
      case ActiveStreamAction.AddUpdate:
        return [...currentStreams, ...(streams || [])];
      case ActiveStreamAction.Remove:
        return currentStreams;
      default:
        return activeStreams;
    }
  }

  /**
   * Converts the seconds into a readable format
   * @param timestamp noOfMilliseconds
   * @returns the time in a human readable string
   */
  forHumans(timestamp: number, levelsCount?: number): string {
    timestamp = Math.abs(timestamp);

    const levels: any = [
      [Math.floor(timestamp / 31536000000), 'years'],
      [Math.floor((timestamp % 31536000000) / 86400000), 'days'],
      [Math.floor(((timestamp % 31536000000) % 86400000) / 3600000), 'hours'],
      [Math.floor((((timestamp % 31536000000) % 86400000) % 3600000) / 60000), 'min'],
      [Math.floor(((((timestamp % 31536000000) % 86400000) % 3600000) % 60000) / 1000), 'sec'],
      // [Math.floor((((((timestamp % 31536000000) % 86400000) % 3600000) % 60000) % 1000) * 100) / 100, 'ms']
    ];
    let returnText = '';

    for (let i = 0, max = levels.length; i < max; i += 1) {
      if (levels[i][0] > 0) {
        returnText += ` ${levels[i][0]} ${levels[i][1]}`;
        if (levelsCount && i > levelsCount) break;
      }
    }
    return returnText.trim();
  }
}
