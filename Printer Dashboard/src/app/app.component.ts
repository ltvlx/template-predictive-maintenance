import { Component, OnInit, ViewChild } from '@angular/core';
import { DataService } from './services/data.service';
import { ConnectionStatus, QuixService } from './services/quix.service';
import { MediaObserver } from '@angular/flex-layout';
import { FormControl } from '@angular/forms';
import { EventData } from './models/eventData';
import { ActiveStream } from './models/activeStream';
import { ActiveStreamAction } from './models/activeStreamAction';
import { ActiveStreamSubscription } from './models/activeStreamSubscription';
import { ParameterData } from './models/parameterData';
import { Data } from '@angular/router';
import { Observable } from 'rxjs';
import { ChartComponent } from './components/chart/chart.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  @ViewChild(ChartComponent) chart: ChartComponent;
  streamsControl = new FormControl();
  printers: any[] = [];
  workspaceId: string;
  deploymentId: string;
  ungatedToken: string;
  activeStreams: ActiveStream[] = [];
  parameterIds: string[] = ['ambient_temperature', 'bed_temperature', 'hotend_temperature'];
  parameterData$: Observable<Data>;

  constructor(private quixService: QuixService, private dataService: DataService, public media: MediaObserver) { }

  ngOnInit(): void {
    this.workspaceId = this.quixService.workspaceId;
    this.ungatedToken = this.quixService.ungatedToken;
    this.deploymentId = '';

    this.quixService.activeStreamsChanged$.subscribe((streamSubscription: ActiveStreamSubscription) => {
      const { streams } = streamSubscription;
      if (!streams?.length) return;
      this.setActiveSteams(streamSubscription)
      if (!this.streamsControl.value) this.streamsControl.setValue(streams.at(0))
    });

    this.parameterData$ = this.quixService.paramDataReceived$;

    this.quixService.readerConnStatusChanged$.subscribe((status) => {
      if (status !== ConnectionStatus.Connected) return;
      this.quixService.subscribeToActiveStreams(this.quixService.printerDataTopic);
      // this.quixService.subscribeToActiveStreams(this.quixService.forecastTopic);
    });


    this.streamsControl.valueChanges.subscribe((stream: ActiveStream) => {
      const printerDataTopicId = this.quixService.workspaceId + '-' + this.quixService.printerDataTopic;
      const forecastTopicId = this.quixService.workspaceId + '-' + this.quixService.forecastTopic;
      this.parameterIds.forEach((parameter) => {
        this.subscribeToParameter(printerDataTopicId, stream.streamId, parameter);
        this.subscribeToParameter(forecastTopicId, stream.streamId + '-forecast-forecast', 'forecast_' + parameter);
        this.subscribeToEvent(forecastTopicId, stream.streamId + '-forecast-forecast-alerts', 'forecast_smoothed_fluctuated_ambient_temperature');
      })
      this.subscribeToParameter(forecastTopicId, stream.streamId + '-forecast-forecast', 'forecast_smoothed_fluctuated_ambient_temperature');
      this.subscribeToEvent(forecastTopicId, stream.streamId + '-forecast-forecast-alerts', 'under-fcast');
      this.dataService.stream = stream;
    });
  }

  subscribeToParameter(topicId: string, streamId: string, parameterId: string): void {
    if (this.dataService.stream) this.quixService.unsubscribeFromParameter(topicId, this.dataService.stream.streamId, parameterId);
    this.quixService.subscribeToParameter(topicId, streamId, parameterId);
  }

  subscribeToEvent(topicId: string, streamId: string, eventId: string): void {
    if (this.dataService.stream) this.quixService.unsubscribeFromEvent(topicId, this.dataService.stream.streamId, eventId);
    this.quixService.subscribeToEvent(topicId, streamId, eventId);
  }

  toggleSidenav(isOpen: boolean): void {
    this.dataService.isSidenavOpen$.next(isOpen);
  }

  /**
   * Handles when a new stream is added or removed.
   *
   * @param action The action we are performing.
   * @param streams The data within the stream.
   */
  private setActiveSteams(streamSubscription: ActiveStreamSubscription): void {
    const { streams, action } = streamSubscription;
    switch (action) {
      case ActiveStreamAction.AddUpdate:
        const newStreams = streams?.filter((stream) => !this.activeStreams.some((s) => s.streamId === stream.streamId)) || [];
        this.activeStreams.push(...newStreams);
        break;
      case ActiveStreamAction.Remove:
        this.activeStreams = this.activeStreams.filter((stream) => streams?.some((s) => s.streamId === stream.streamId));
        break;
      default: break;
    }
  }
}
